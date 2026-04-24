import express from "express";
import cookieParser from "cookie-parser";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { StrategyEngine } from "./src/services/strategy";
import { DEFAULT_SETTINGS } from "./src/constants";
import { AppSettings } from "./src/types";
import { dbService } from "./src/services/database";
import { WebSocketServer } from "ws";
import rateLimit from "express-rate-limit";

import CryptoJS from "crypto-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(process.cwd(), "settings.json");
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "supernode-secret-key";

// Settings lock to prevent race conditions during global state updates
class AsyncLock {
  private promise: Promise<void> | null = null;
  async acquire() {
    while (this.promise) await this.promise;
    let release: () => void;
    this.promise = new Promise(resolve => { release = resolve; });
    return () => { this.promise = null; release(); };
  }
}
const settingsLock = new AsyncLock();

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function encrypt(text: string) {
  if (!text) return text;
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

function decrypt(ciphertext: string) {
  if (!ciphertext) return ciphertext;
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    return decrypted || ciphertext;
  } catch (e) {
    return ciphertext;
  }
}

function mergeSettings(loaded: any): AppSettings {
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...loaded,
    appName: loaded.appName || DEFAULT_SETTINGS.appName,
    accounts: (Array.isArray(loaded.accounts) && loaded.accounts.length > 0 ? loaded.accounts : DEFAULT_SETTINGS.accounts).map((acc: any) => {
      const defAcc = DEFAULT_SETTINGS.accounts[0];
      return {
        ...defAcc,
        ...acc,
        id: (acc.id || defAcc.id).toString().trim(),
        name: acc.name || defAcc.name,
        enabled: acc.enabled !== undefined ? acc.enabled : defAcc.enabled,
        binance: { ...defAcc.binance, ...(acc.binance || {}) },
        scanner: {
          ...defAcc.scanner,
          ...(acc.scanner || {}),
          stage0: { ...defAcc.scanner.stage0, ...(acc.scanner?.stage0 || {}) },
          stage0P: { 
            ...defAcc.scanner.stage0P, 
            ...(acc.scanner?.stage0P || {}),
            periods: { ...defAcc.scanner.stage0P.periods, ...(acc.scanner?.stage0P?.periods || {}) },
            abnormalMove: { ...defAcc.scanner.stage0P.abnormalMove, ...(acc.scanner?.stage0P?.abnormalMove || {}) }
          },
          stage1: { ...defAcc.scanner.stage1, ...(acc.scanner?.stage1 || {}) },
          stage2: { 
            ...defAcc.scanner.stage2, 
            ...(acc.scanner?.stage2 || {}),
            preferredMode: acc.scanner?.stage2?.preferredMode || defAcc.scanner.stage2.preferredMode,
            conditions: {
              ...defAcc.scanner.stage2.conditions,
              ...(acc.scanner?.stage2?.conditions || {}),
              a: {
                ...defAcc.scanner.stage2.conditions.a,
                ...(acc.scanner?.stage2?.conditions?.a || {}),
                mode: acc.scanner?.stage2?.conditions?.a?.mode || defAcc.scanner.stage2.conditions.a.mode,
                fixedRange: acc.scanner?.stage2?.conditions?.a?.fixedRange || acc.scanner?.stage2?.conditions?.a?.range || defAcc.scanner.stage2.conditions.a.fixedRange,
                relativeRange: acc.scanner?.stage2?.conditions?.a?.relativeRange || defAcc.scanner.stage2.conditions.a.relativeRange,
              }
            }
          },
          timeControl: { 
            ...defAcc.scanner.timeControl, 
            ...(acc.scanner?.timeControl || {}),
            mode: (acc.scanner?.timeControl?.mode === '+8') ? '+2' : (acc.scanner?.timeControl?.mode === '-8' ? '-2' : (acc.scanner?.timeControl?.mode || defAcc.scanner.timeControl.mode))
          },
        },
        order: { ...defAcc.order, ...(acc.order || {}) },
        withdrawal: { ...defAcc.withdrawal, ...(acc.withdrawal || {}) },
      };
    }),
    email: { ...DEFAULT_SETTINGS.email, ...(loaded.email || {}) },
    auth: { ...DEFAULT_SETTINGS.auth, ...(loaded.auth || {}) },
  };
  return settings;
}

async function loadSettings(): Promise<AppSettings> {
  // 1. Try to load from SQLite database first
  try {
    await dbService.init();
    const dbSettings = await dbService.getSettings('app_settings_global');
    if (dbSettings) {
      const merged = mergeSettings(dbSettings);
      console.log(`[Settings] Loaded from SQLite. Accounts: ${merged.accounts.length}`);
      return merged;
    }
  } catch (e: any) {
    console.error("[Settings] DB Load error:", e.message);
  }

  // 2. Fallback to settings.json
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
      const loaded = JSON.parse(data);
      const merged = mergeSettings(loaded);
      console.log(`[Settings] Loaded from JSON. Accounts: ${merged.accounts.length}`);
      return merged;
    } catch (e: any) {
      console.error("[Settings] JSON Load error:", e.message);
    }
  }

  console.log("[Settings] Using defaults.");
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

async function saveGlobalSettings(settings: any) {
  try {
    console.log(`Saving global settings to: ${SETTINGS_FILE} and database.`);
    const settingsToSave = JSON.parse(JSON.stringify(settings));
    
    // Save to file
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settingsToSave, null, 2));
    
    // Save to database
    await dbService.saveSettings(settingsToSave, 'app_settings_global');
    
    console.log("Global settings saved successfully everywhere.");
  } catch (e) {
    console.error("Failed to save global settings", e);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  const unlockLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 attempts per 15 minutes
    message: { success: false, message: "尝试次数过多，请 15 分钟后再试。" }
  });

  // Gatekeeper Middleware (门卫功能)
  const GATEKEEPER_KEY = process.env.GATEKEEPER_KEY;
  if (GATEKEEPER_KEY) {
    console.log("Gatekeeper mode enabled. Protecting routes with X-Gatekeeper-Key header or gatekeeper_token cookie.");
    app.use((req, res, next) => {
      // Allow health check, static assets, and unlock endpoint without key
      if (
        req.path === "/api/health" || 
        req.path === "/api/gatekeeper/unlock" || 
        req.path.startsWith("/assets/") || 
        req.path === "/favicon.ico"
      ) {
        return next();
      }
      
      const key = req.headers["x-gatekeeper-key"] || req.cookies["gatekeeper_token"];
      if (key === GATEKEEPER_KEY) {
        next();
      } else {
        // Determine if this is a browser request for a page
        const acceptsHtml = req.headers.accept && req.headers.accept.includes("text/html");
        const isApi = req.path.startsWith("/api/");
        
        if (acceptsHtml && !isApi) {
          // For browser requests, show a simple unlock page
          return res.status(403).send(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Gatekeeper Unlock</title>
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f4f7f9; }
                .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 10px 25px rgba(0,0,0,0.05); width: 100%; max-width: 400px; text-align: center; }
                h1 { margin-top: 0; color: #1a202c; font-size: 1.5rem; }
                p { color: #718096; margin-bottom: 2rem; }
                input { width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 0.5rem; margin-bottom: 1rem; box-sizing: border-box; font-size: 1rem; }
                button { width: 100%; padding: 0.75rem; background: #3182ce; color: white; border: none; border-radius: 0.5rem; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.2s; }
                button:hover { background: #2b6cb0; }
                .error { color: #e53e3e; margin-top: 1rem; font-size: 0.875rem; display: none; }
              </style>
            </head>
            <body>
              <div class="card">
                <h1>Gatekeeper</h1>
                <p>请输入访问密钥以解锁应用</p>
                <input type="password" id="keyInput" placeholder="输入密钥..." onkeydown="if(event.key==='Enter') unlock()">
                <button onclick="unlock()">解锁</button>
                <div id="errorMsg" class="error">密钥错误，请重试</div>
              </div>
              <script>
                async function unlock() {
                  const key = document.getElementById('keyInput').value;
                  const res = await fetch('/api/gatekeeper/unlock', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key })
                  });
                  if (res.ok) {
                    window.location.reload();
                  } else {
                    document.getElementById('errorMsg').style.display = 'block';
                  }
                }
              </script>
            </body>
            </html>
          `);
        }

        // Otherwise return JSON for API calls or assets
        res.status(403).json({ 
          success: false, 
          gatekeeper: true,
          message: "Gatekeeper: Access Denied. Please unlock with your key." 
        });
      }
    });
  }

  // Initialize Strategy Engines
  console.log("Initializing Strategy Engines...");
  let bootSettings = await loadSettings();
  
  // MIGRATION: Ensure 3 default accounts exist if currently only "default" is setup
  if (bootSettings.accounts.length === 1 && bootSettings.accounts[0].id === "default") {
    console.log("Migration: Expanding default setup to 3 accounts...");
    const baseAcc = bootSettings.accounts[0];
    
    // Perform deep copy to prevent shared object references in settings
    const acc2 = JSON.parse(JSON.stringify(baseAcc));
    acc2.id = "acc_2";
    acc2.name = "账户2";
    acc2.enabled = true;
    acc2.binance.apiKey = '';
    acc2.binance.secretKey = '';
    
    const acc3 = JSON.parse(JSON.stringify(baseAcc));
    acc3.id = "acc_3";
    acc3.name = "账户3";
    acc3.enabled = true;
    acc3.binance.apiKey = '';
    acc3.binance.secretKey = '';

    bootSettings.accounts = [ baseAcc, acc2, acc3 ];
    await saveGlobalSettings(bootSettings);
  }

  const engines: Map<string, StrategyEngine> = new Map();
  
  let primaryAccountId: string | null = null;
  
  for (const account of bootSettings.accounts) {
    // Construct individual settings for this engine
    const engineSettings: any = {
      ...account,
      email: bootSettings.email,
      appName: bootSettings.appName,
      auth: bootSettings.auth
    };
    
    const engine = new StrategyEngine(account.id, engineSettings);
    engines.set(account.id, engine);
    
    if (!primaryAccountId) {
      primaryAccountId = account.id;
    }
    console.log(`- Account [${account.id}] (${account.name}) initialized.`);
  }

  // Set up shared data if multiple engines exist
  if (primaryAccountId && engines.size > 1) {
    const primaryEngine = engines.get(primaryAccountId)!;
    for (const [id, engine] of engines.entries()) {
      if (id !== primaryAccountId) {
        engine.setExternalMarketSource({
          getKline: (symbol) => (primaryEngine as any).getCachedKline(symbol),
          getStage0Results: () => (primaryEngine as any).getStage0Results(),
          getStage0PResults: () => (primaryEngine as any).getStage0PResults(),
        });
        console.log(`- Account [${id}] set to consume shared market data from [${primaryAccountId}].`);
      }
    }
  }

  // Stagger start for all defined accounts automatically
  (async () => {
    let settingsUpdated = false;
    const accountIds = Array.from(engines.keys());
    for (let i = 0; i < accountIds.length; i++) {
      const accountId = accountIds[i];
      const engine = engines.get(accountId);
      if (engine) {
        const accDef = bootSettings.accounts.find(a => a.id === accountId);
        
        // ONLY start the engine automatically if the account is currently enabled.
        if (accDef && accDef.enabled) {
          console.log(`Starting engine for account [${accountId}] (${i+1}/${accountIds.length})...`);
          engine.start().catch((err: any) => console.error(`[${accountId}] failed to start:`, err));

          // 5 seconds delay before starting the NEXT account
          if (i < accountIds.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        } else {
          console.log(`Account [${accountId}] is disabled. Skipping auto-start.`);
        }
      }
    }
    
    // Save updated enabled states if changed
    if (settingsUpdated) {
      await saveGlobalSettings(bootSettings);
    }
  })();

  const getEngine = (req: express.Request): StrategyEngine | undefined => {
    const accountId = (req.query.accountId as string || req.headers['x-account-id'] as string || '').trim();
    return engines.get(accountId);
  };

  // Middleware to ensure selected account engine exists
  const engineMiddleware = (req: any, res: any, next: any) => {
    const engine = getEngine(req);
    if (!engine) {
      if (req.path === '/settings' || req.path === '/api/settings') {
        return next(); // Allow global settings fetch/update without engine
      }
      return res.status(404).json({ success: false, message: "账户不存在或引擎未启动" });
    }
    req.engine = engine;
    next();
  };

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString(), accounts: Array.from(engines.keys()) });
  });

  app.post("/api/gatekeeper/unlock", unlockLimiter, async (req, res) => {
    const { key } = req.body;
    if (key === GATEKEEPER_KEY) {
      res.cookie("gatekeeper_token", key, { 
        maxAge: 30 * 24 * 60 * 60 * 1000, 
        httpOnly: true,
        path: "/"
      });
      
      // Ensure global settings are present, don't use bootSettings which might be stale
      const currentSettings = await loadSettings();
      await saveGlobalSettings(currentSettings);
      
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, message: "密钥错误" });
    }
  });

  app.get("/api/accounts", async (req, res) => {
    try {
      const globalSettings = await loadSettings();
      const accountList = globalSettings.accounts.map(acc => {
        const engine = engines.get(acc.id);
        return {
          id: acc.id,
          name: acc.name,
          enabled: engine ? engine.getSystemStatus().isRunning : false
        };
      });
      res.json(accountList);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/ip", async (req, res) => {
    try {
      const { default: axios } = await import("axios");
      const response = await axios.get("https://api.ipify.org?format=json", { timeout: 5000 });
      res.json(response.data);
    } catch (error: any) {
      console.error("Failed to fetch server IP:", error.message);
      res.json({ ip: "获取失败" });
    }
  });

  app.get("/api/dashboard-all", engineMiddleware, async (req: any, res) => {
    try {
      const engine = req.engine;
      const [status, logs, tradeLogs, transferLogs, balanceLogs, accountData, ip] = await Promise.all([
        Promise.resolve(engine.getSystemStatus()),
        Promise.resolve(engine.getLogs()),
        Promise.resolve(engine.getTradeLogs()),
        Promise.resolve(engine.getTransferLogs()),
        dbService.getBalanceLogs(engine.accountId, 100),
        Promise.resolve(engine.getAccountData()),
        // Add a small cache or timeout for IP fetch to prevent blocking
        Promise.resolve({ ip: "fetching..." }) 
      ]);

      res.json({
        status,
        logs,
        tradeLogs,
        transferLogs,
        balanceLogs,
        account: accountData,
        ip
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/status", engineMiddleware, (req: any, res) => {
    res.json(req.engine.getSystemStatus());
  });

  app.post("/api/check-status", engineMiddleware, async (req: any, res) => {
    const result = await req.engine.checkApiStatus();
    res.json(result);
  });

  app.post("/api/force-scan", engineMiddleware, async (req: any, res) => {
    const { stage } = req.body;
    await req.engine.forceScan(Number(stage));
    res.json({ success: true });
  });

  app.post("/api/engine/start", engineMiddleware, async (req: any, res) => {
    req.engine.start();
    const globalSettings = await loadSettings();
    const acc = globalSettings.accounts.find((a: any) => a.id === req.engine.accountId);
    if (acc) {
      acc.enabled = true;
      await saveGlobalSettings(globalSettings);
    }
    res.json({ success: true, isRunning: true });
  });

  app.post("/api/engine/stop", engineMiddleware, async (req: any, res) => {
    req.engine.stop();
    const globalSettings = await loadSettings();
    const acc = globalSettings.accounts.find((a: any) => a.id === req.engine.accountId);
    if (acc) {
      acc.enabled = false;
      await saveGlobalSettings(globalSettings);
    }
    res.json({ success: true, isRunning: false });
  });

  app.get("/api/logs", engineMiddleware, (req: any, res) => {
    res.json(req.engine.getLogs());
  });

  app.get("/api/trade-logs", engineMiddleware, (req: any, res) => {
    res.json(req.engine.getTradeLogs());
  });

  app.get("/api/transfer-logs", engineMiddleware, (req: any, res) => {
    res.json(req.engine.getTransferLogs());
  });

  app.get("/api/balance-logs", engineMiddleware, (req: any, res) => {
    res.json(req.engine.getBalanceLogs());
  });

  app.get("/api/balance-logs/search", engineMiddleware, async (req: any, res) => {
    try {
      const { startTime, endTime, onlySnapshot } = req.query;
      const logs = await req.engine.searchBalanceLogs(
        Number(startTime),
        Number(endTime),
        onlySnapshot === 'true'
      );
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.post("/api/logs/clear", engineMiddleware, (req: any, res) => {
    req.engine.clearLogs();
    res.json({ success: true });
  });

  app.post("/api/trade-logs/clear", engineMiddleware, (req: any, res) => {
    req.engine.clearTradeLogs();
    res.json({ success: true });
  });

  app.post("/api/transfer-logs/clear", engineMiddleware, (req: any, res) => {
    req.engine.clearTransferLogs();
    res.json({ success: true });
  });

  app.post("/api/balance-logs/clear", engineMiddleware, (req: any, res) => {
    req.engine.clearBalanceLogs();
    res.json({ success: true });
  });

  app.post("/api/trade-logs/sync", engineMiddleware, async (req: any, res) => {
    try {
      const { symbol, startTime, endTime } = req.body;
      const logs = await req.engine.searchTradeLogsLocally(symbol, startTime, endTime);
      res.json({ success: true, logs });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/scan-results", engineMiddleware, (req: any, res) => {
    const { stage } = req.query;
    res.json(req.engine.getScanResults(Number(stage)));
  });

  app.get("/api/all-scan-results", engineMiddleware, (req: any, res) => {
    res.json(req.engine.getAllScanResults());
  });

  app.get("/api/settings", engineMiddleware, async (req: any, res) => {
    try {
      const mode = req.query.mode;
      if (mode === 'global' || !req.engine) {
        const globalSettings = await loadSettings();
        return res.json(globalSettings);
      }
      
      res.json(req.engine.getSettings());
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/accounts/add", async (req, res) => {
    const release = await settingsLock.acquire();
    try {
      const globalSettings = await loadSettings();
      const newId = `acc_${Date.now()}`;
      
      console.log(`[Server] LOCKED add account request: ${newId}`);
      
      const template = globalSettings.accounts.length > 0 ? globalSettings.accounts[0] : DEFAULT_SETTINGS.accounts[0];
      
      const newAccount = {
        ...JSON.parse(JSON.stringify(template)),
        id: newId,
        name: `新账户 ${globalSettings.accounts.length + 1}`,
        enabled: true,
        binance: { ...template.binance, apiKey: '', secretKey: '' }
      };
      
      globalSettings.accounts.push(newAccount);
      await saveGlobalSettings(globalSettings);
      
      const engine = new StrategyEngine(newId, newAccount);
      engines.set(newId, engine);
      
      if (engines.size > 1) {
        const primaryEngine = engines.values().next().value;
        engine.setExternalMarketSource({
          getKline: (symbol: string) => primaryEngine.getCachedKline(symbol),
          getStage0Results: () => primaryEngine.getStage0Results(),
          getStage0PResults: () => primaryEngine.getStage0PResults()
        });
      }
      
      // Delay 5 seconds before starting a newly added account, to be consistent with the 5s staggered rule.
      setTimeout(() => {
        engine.start().catch(err => console.error(`[${newId}] failed to start:`, err));
      }, 5000);
      
      engine.setUpdateCallback((type, data) => {
        const message = JSON.stringify({ accountId: newId, type, data });
        wss.clients.forEach(client => {
          if (client.readyState === 1) {
             // @ts-ignore
            if (client.accountId === newId || !client.accountId) {
               client.send(message);
            }
          }
        });
      });

      release();
      res.json({ success: true, account: newAccount });
    } catch (error: any) {
      if (typeof release === 'function') release();
      console.error("Failed to add account:", error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.delete("/api/accounts/:id", async (req, res) => {
    const release = await settingsLock.acquire();
    try {
      const id = (req.params.id || '').toString().trim();
      if (!id) {
        release();
        return res.status(400).json({ success: false, message: "无效的账户ID" });
      }
      
      console.log(`[Server] INITIATING DELETION for: "${id}"`);
      
      // 1. Stop and remove engine FIRST to prevent background tasks from interfering
      const engine = engines.get(id);
      if (engine) {
        console.log(`[Server] Force stopping engine: ${id}`);
        engine.stop();
        engines.delete(id);
      }

      // Load current settings fresh
      let globalSettings = await loadSettings();
      const initialCount = globalSettings.accounts.length;
      
      if (initialCount <= 1) {
        release();
        return res.status(400).json({ success: false, message: "无法删除最后一个账户" });
      }
      
      // Filter out the account
      const filtered = globalSettings.accounts.filter(acc => acc.id.toString().trim() !== id);
      
      if (filtered.length < initialCount) {
        globalSettings.accounts = filtered;
        
        // PERSIST
        await saveGlobalSettings(globalSettings);
        
        // Clear all database records associated with this account
        await dbService.clearAccountData(id);
        
        // Final verification check
        const verifiedSettings = await loadSettings();
        if (verifiedSettings.accounts.find(a => a.id === id)) {
          console.error(`[Server] PERSISTENCE FAILURE: ${id} still in verified list!`);
          // Try to save again if it failed
          await saveGlobalSettings(globalSettings);
        }

        release();
        console.log(`[Server] DELETION OF "${id}" IS FINAL.`);
        return res.json({ success: true, removedId: id });
      } else {
        release();
        return res.status(404).json({ success: false, message: "账户不存在" });
      }
    } catch (error: any) {
      if (typeof release === 'function') release();
      console.error("[Server] Critical error during account deletion:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/account", engineMiddleware, (req: any, res) => {
    res.json(req.engine.getAccountData());
  });

  app.post("/api/account/refresh", engineMiddleware, async (req: any, res) => {
    await req.engine.fetchAccountData();
    res.json({ success: true, account: req.engine.getAccountData() });
  });

  app.post("/api/transfer/to-futures", engineMiddleware, async (req: any, res) => {
    try {
      const { amount } = req.body;
      const result = await req.engine.transferToFutures(amount.toString());
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/test-email", engineMiddleware, async (req: any, res) => {
    try {
      // @ts-ignore - accessing private method for testing
      await req.engine.sendEmail("测试邮件", "这是一封测试邮件，用于检测邮件发送功能。");
      res.json({ success: true, message: "测试邮件已发送，请检查日志或收件箱。" });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/settings/restore", engineMiddleware, async (req: any, res) => {
    const release = await settingsLock.acquire();
    try {
      console.log("[Server] LOCKED restoring settings to defaults...");
      if (fs.existsSync(SETTINGS_FILE)) {
        fs.unlinkSync(SETTINGS_FILE);
        console.log("Deleted settings.json");
      }
      
      const defaults = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      // Reset current engine's account settings to match first account in defaults
      const accDefaults = defaults.accounts[0];
      const newSettings = {
        ...req.engine.getSettings(),
        binance: accDefaults.binance,
        scanner: accDefaults.scanner,
        order: accDefaults.order,
        withdrawal: accDefaults.withdrawal
      };
      
      await req.engine.updateSettings(newSettings);
      
      release();
      res.json({ success: true, settings: newSettings });
    } catch (error: any) {
      if (typeof release === 'function') release();
      console.error("Failed to restore settings:", error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/settings", engineMiddleware, async (req: any, res) => {
    const release = await settingsLock.acquire();
    try {
      const settings = req.body;
      const accountId = req.engine ? req.engine.accountId : null;
      console.log(`[Server] LOCKED settings update for [${accountId || 'GLOBAL'}]`);
      
      if (req.engine) {
        await req.engine.updateSettings(settings);
      }
      
      // Update global settings set
      const globalSettings = await loadSettings();
      
      // Update global fields if present
      if (settings.appName) globalSettings.appName = settings.appName;
      if (settings.email) globalSettings.email = settings.email;
      if (settings.auth) globalSettings.auth = settings.auth;
      
      // Update account-specific fields
      if (accountId) {
        const accountIdx = globalSettings.accounts.findIndex(acc => acc.id === accountId);
        if (accountIdx !== -1) {
          // Merge allowed account-specific fields
          globalSettings.accounts[accountIdx] = {
            ...globalSettings.accounts[accountIdx],
            name: settings.name || globalSettings.accounts[accountIdx].name,
            binance: settings.binance || globalSettings.accounts[accountIdx].binance,
            scanner: settings.scanner || globalSettings.accounts[accountIdx].scanner,
            order: settings.order || globalSettings.accounts[accountIdx].order,
            withdrawal: settings.withdrawal || globalSettings.accounts[accountIdx].withdrawal,
            enabled: settings.enabled !== undefined ? settings.enabled : globalSettings.accounts[accountIdx].enabled
          };
        }
      }
      
      await saveGlobalSettings(globalSettings);
      
      release();
      console.log(`[Server] UNLOCKED settings update for [${accountId || 'GLOBAL'}]`);
      res.json({ success: true, settings: req.engine ? req.engine.settings : globalSettings });
    } catch (error: any) {
      if (typeof release === 'function') release();
      console.error("Failed to update settings:", error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    const currentSettings = await loadSettings(); // Use fresh settings for login
    if (username === currentSettings.auth.username && password === currentSettings.auth.password) {
      res.json({ success: true, token: "mock-token" });
    } else {
      res.status(401).json({ success: false, message: "账号或密码错误" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Start All Strategy Engines
    console.log("Starting All Strategy Engines...");
    for (const [id, engine] of engines.entries()) {
      engine.start().catch(err => console.error(`Account [${id}] failed to start:`, err));
    }
  });

  // WebSocket Server for real-time updates
  const wss = new WebSocketServer({ server });
  
  for (const [id, engine] of engines.entries()) {
    engine.setUpdateCallback((type, data) => {
      const message = JSON.stringify({ accountId: id, type, data });
      wss.clients.forEach(client => {
        if (client.readyState === 1) { // 1 is OPEN
           // @ts-ignore - custom property on ws
          if (client.accountId === id || !client.accountId) {
             client.send(message);
          }
        }
      });
    });
  }

  wss.on('connection', (ws: any, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const accountId = url.searchParams.get('accountId') || primaryAccountId;
    ws.accountId = accountId;

    console.log(`New client connected to UI WebSocket for account: ${accountId}`);
    
    const engine = engines.get(accountId || '');
    if (engine) {
      ws.send(JSON.stringify({ accountId, type: 'status', data: engine.getSystemStatus() }));
      ws.send(JSON.stringify({ accountId, type: 'logs', data: engine.getLogs() }));
    }
  });
}

startServer();
