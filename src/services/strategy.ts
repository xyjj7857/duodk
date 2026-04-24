import { BinanceService } from './binance';
import { AppSettings, LogEntry, Position, TradeLog, TransferLog, BalanceLog, Kline } from '../types';
import WebSocket from 'ws';
import nodemailer from 'nodemailer';
import { dbService } from './database';
import { APP_NAME, DEFAULT_SETTINGS } from '../constants';

export class StrategyEngine {
  private binance: BinanceService;
  private settings: any;
  public accountId: string;
  private logs: LogEntry[] = [];
  private tradeLogs: TradeLog[] = [];
  private transferLogs: TransferLog[] = [];
  private balanceLogs: BalanceLog[] = [];
  private lastBalanceRecordHour: number = -1;
  private isRunning: boolean = false;
  private apiConnected: boolean = true;
  private wsConnected: boolean = false;
  private currentPosition: Position | null = null;
  private lastScanTime: number = 0;
  private lastMarketDataTime: number = Date.now();
  private lastS0Run: number = 0;
  private lastS0PRun: number = 0;
  private lastS1Run: number = 0;
  private lastS2Run: number = 0;
  private ws: WebSocket | null = null;
  private marketWss: WebSocket[] = [];
  private static globalKlineCache: Map<string, any> = new Map();
  private static primaryWsEngineId: string | null = null;
  private listenKey: string | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectDelay: number = 60000; // Max 1 minute
  private accountData: any = {
    totalBalance: '0.00',
    availableBalance: '0.00',
    spotBalance: '0.00',
    positions: [],
    openOrders: []
  };

  private stage0Results: any = { data: [], scannedCount: 0, startTime: 0, duration: 0 };
  private stage0PResults: any = { data: [], scannedCount: 0, startTime: 0, duration: 0 };
  private stage1Results: any = { data: [], scannedCount: 0, startTime: 0, duration: 0 };
  private stage2Results: any = { data: [], scannedCount: 0, startTime: 0, duration: 0 };
  private isOrdering: boolean = false;
  private pendingOrderSymbol: string | null = null;
  private exchangeInfo: any = null;
  private previousPositions: any[] = [];
  private closedPositionsHistory: Map<string, number> = new Map();
  private pendingCloseSymbols: Map<string, number> = new Map();
  private lastReplenishmentEmailTime: number = 0;
  private balanceAlertSent: boolean = false;
  private isWithdrawing: boolean = false;
  private lastAccountFetchTime: number = 0;
  private lastApiCheckTime: number = 0;
  private timeOffset: number = 0;
  private lastTimeSyncTime: number = 0;
  private noOrdersStartTime: number | null = null;
  private emptyAccountStartTime: number | null = null;
  private shouldCheckTransfer: boolean = false;
  private isCancelling: boolean = false;
  private isClosing: boolean = false;
  private fetchAccountTimer: NodeJS.Timeout | null = null;
  private fetchAccountOptions: { skipCleanup?: boolean } = {};
  private isBanned: boolean = false;
  private banUntil: number = 0;
  private lockingSymbols: Set<string> = new Set();
  private notifiedDustSymbols: Set<string> = new Set();
  private isFullMarketMonitoring: boolean = false;
  private lastSubscribedSymbolSet: Set<string> = new Set();
  private onUpdate?: (type: 'log' | 'status' | 'account' | 'logs' | 'tradeLogs' | 'transferLogs' | 'balanceLogs' | 'settings', data: any) => void;

  private externalMarketSource?: {
    getKline: (symbol: string) => any;
    getStage0Results: () => any;
    getStage0PResults: () => any;
  };

  private static isGlobalSyncingKlines = false;
  private static lastGlobalSyncTime = 0;

  constructor(accountId: string, settings: any, initialTradeLogs: TradeLog[] = []) {
    this.accountId = accountId;
    this.settings = settings;
    this.tradeLogs = initialTradeLogs;
    this.binance = new BinanceService(settings.binance);
  }

  setExternalMarketSource(source: {
    getKline: (symbol: string) => any;
    getStage0Results: () => any;
    getStage0PResults: () => any;
  }) {
    this.externalMarketSource = source;
  }

  setUpdateCallback(cb: (type: 'log' | 'status' | 'account' | 'logs' | 'tradeLogs' | 'transferLogs' | 'balanceLogs' | 'settings', data: any) => void) {
    this.onUpdate = cb;
  }

  public getCachedKline(symbol: string) {
    if (this.externalMarketSource) {
      return this.externalMarketSource.getKline(symbol);
    }
    return StrategyEngine.globalKlineCache.get(symbol);
  }

  private hasCachedKline(symbol: string) {
    if (this.externalMarketSource) {
      return this.externalMarketSource.getKline(symbol) !== undefined;
    }
    return StrategyEngine.globalKlineCache.has(symbol);
  }

  private addLog(module: string, message: string, type: LogEntry['type'] = 'info', details?: any) {
    // 如果引擎已停止，除了核心停止日志外不再接收新日志，防止僵尸进程日志干扰
    if (!this.isRunning && module !== '系统' && !message.includes('停止')) {
      return;
    }
    
    const accountName = this.settings?.name || this.accountId;
    const log: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      type,
      module: `[${accountName}] ${module}`,
      message,
      details,
    };
    this.logs.unshift(log);
    if (this.logs.length > 1000) this.logs.pop();
    console.log(`[${accountName}][${module}] ${message}`);
    
    if (this.onUpdate) {
      this.onUpdate('log', log);
    }
  }

  private addTradeLog(trade: TradeLog) {
    this.tradeLogs.unshift(trade);
    if (this.tradeLogs.length > 5000) this.tradeLogs.pop();
    
    // Persist to database
    dbService.saveTradeLog(trade, this.accountId).catch(err => {
      console.error(`[${this.accountId}] Failed to save trade log to database:`, err);
    });

    if (this.onUpdate) {
      this.onUpdate('tradeLogs', this.tradeLogs);
    }
  }

  private addTransferLog(transfer: TransferLog) {
    this.transferLogs.unshift(transfer);
    if (this.transferLogs.length > 1000) this.transferLogs.pop();
    
    // Persist to database
    dbService.saveTransferLog(transfer, this.accountId).catch(err => {
      console.error(`[${this.accountId}] Failed to save transfer log to database:`, err);
    });

    if (this.onUpdate) {
      this.onUpdate('transferLogs', this.transferLogs);
    }
  }

  private updateTradeLog(id: string, updates: Partial<TradeLog>) {
    const index = this.tradeLogs.findIndex(t => t.id === id);
    if (index !== -1) {
      this.tradeLogs[index] = { ...this.tradeLogs[index], ...updates };
      
      // Persist to database
      dbService.saveTradeLog(this.tradeLogs[index], this.accountId).catch(err => {
        console.error(`[${this.accountId}] Failed to update trade log in database:`, err);
      });

      if (this.onUpdate) {
        this.onUpdate('tradeLogs', this.tradeLogs);
      }
    }
  }

  private mergeSettings(loaded: any): any {
    const accDefault = DEFAULT_SETTINGS.accounts[0];
    return {
      ...accDefault,
      ...loaded,
      binance: { ...accDefault.binance, ...(loaded.binance || {}) },
      scanner: {
        ...accDefault.scanner,
        ...(loaded.scanner || {}),
        stage0: { ...accDefault.scanner.stage0, ...(loaded.scanner?.stage0 || {}) },
        stage0P: { 
          ...accDefault.scanner.stage0P, 
          ...(loaded.scanner?.stage0P || {}),
          periods: { ...accDefault.scanner.stage0P.periods, ...(loaded.scanner?.stage0P?.periods || {}) },
          abnormalMove: { ...accDefault.scanner.stage0P.abnormalMove, ...(loaded.scanner?.stage0P?.abnormalMove || {}) }
        },
        stage1: { ...accDefault.scanner.stage1, ...(loaded.scanner?.stage1 || {}) },
        stage2: { 
          ...accDefault.scanner.stage2, 
          ...(loaded.scanner?.stage2 || {}),
          preferredMode: loaded.scanner?.stage2?.preferredMode || accDefault.scanner.stage2.preferredMode,
          conditions: {
            ...accDefault.scanner.stage2.conditions,
            ...(loaded.scanner?.stage2?.conditions || {}),
            a: {
              ...accDefault.scanner.stage2.conditions.a,
              ...(loaded.scanner?.stage2?.conditions?.a || {}),
              mode: loaded.scanner?.stage2?.conditions?.a?.mode || accDefault.scanner.stage2.conditions.a.mode,
              fixedRange: loaded.scanner?.stage2?.conditions?.a?.fixedRange || loaded.scanner?.stage2?.conditions?.a?.range || accDefault.scanner.stage2.conditions.a.fixedRange,
              relativeRange: loaded.scanner?.stage2?.conditions?.a?.relativeRange || accDefault.scanner.stage2.conditions.a.relativeRange,
            }
          }
        },
        timeControl: { 
          ...accDefault.scanner.timeControl, 
          ...(loaded.scanner?.timeControl || {}),
          mode: (loaded.scanner?.timeControl?.mode === '+8') ? '+2' : (loaded.scanner?.timeControl?.mode === '-8' ? '-2' : (loaded.scanner?.timeControl?.mode || accDefault.scanner.timeControl.mode))
        },
      },
      order: { ...accDefault.order, ...(loaded.order || {}) },
      withdrawal: { ...accDefault.withdrawal, ...(loaded.withdrawal || {}) },
    };
  }

  async start() {
    console.log("StrategyEngine.start() called. isRunning:", this.isRunning);
    if (this.isRunning) return;
    
    if (this.isBanned) {
      this.addLog('系统', `由于 IP 仍处于封禁期 (至 ${new Date(this.banUntil).toLocaleString()})，无法启动策略。`, 'warning');
      return;
    }
    
    // Initialize database and load logs
    try {
      await dbService.init();
      
      // Load settings from database first
      const dbSettings = await dbService.getSettings(`settings_${this.accountId}`);
      if (dbSettings) {
        this.settings = this.mergeSettings(dbSettings);
        this.binance = new BinanceService(this.settings.binance);
        this.addLog('系统', '从数据库加载设置成功', 'success');
      }

      const savedLogs = await dbService.getAllTradeLogs(this.accountId);
      if (savedLogs && savedLogs.length > 0) {
        this.tradeLogs = savedLogs;
        console.log(`[${this.accountId}] Loaded ${savedLogs.length} trade logs from database.`);
      }

      const savedTransferLogs = await dbService.getAllTransferLogs(this.accountId);
      if (savedTransferLogs && savedTransferLogs.length > 0) {
        this.transferLogs = savedTransferLogs;
        console.log(`[${this.accountId}] Loaded ${savedTransferLogs.length} transfer logs from database.`);
      }

      const savedBalanceLogs = await dbService.getBalanceLogs(this.accountId);
      if (savedBalanceLogs && savedBalanceLogs.length > 0) {
        this.balanceLogs = savedBalanceLogs;
        console.log(`[${this.accountId}] Loaded ${savedBalanceLogs.length} balance logs from database.`);
      }
    } catch (error) {
      console.error(`[${this.accountId}] Failed to initialize database or load logs:`, error);
    }

    // Sync Klines from Binance REST API (Rate-limited startup sync)
    this.syncKlines().catch(err => {
      this.addLog('系统', `K线自动补齐时出错: ${err.message}`, 'error');
    });

    this.isRunning = true;
    this.addLog('系统', '策略引擎启动', 'success');
    
    // 启动时如果结果为空，先执行一次初筛
    if (this.stage0Results.data.length === 0) {
      await this.runStage0();
      await this.runStage0P();
    }

    this.runLoop();
    // Initial status check
    this.checkApiStatus();
    // Initial time sync
    await this.syncTime();
    // Start WebSocket
    this.initWebSocket();
    // Fetch initial account data
    await this.fetchAccountData();
    // 根据当前时间启动市场数据订阅（全市场或仅持仓）
    await this.manageMarketDataStreams();
  }

  stop() {
    this.isRunning = false;
    this.cleanupWs();
    this.cleanupMarketWs();
    if (this.fetchAccountTimer) {
      clearTimeout(this.fetchAccountTimer);
      this.fetchAccountTimer = null;
    }
    
    if (StrategyEngine.primaryWsEngineId === this.accountId) {
      StrategyEngine.primaryWsEngineId = null;
    }
    
    this.addLog('系统', '策略引擎停止', 'warning');
  }

  private cleanupWs() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.terminate();
      }
      this.ws = null;
    }
    this.wsConnected = false;
  }

  private async manageMarketDataStreams() {
    const now = new Date(Date.now() + this.timeOffset);
    const minute = now.getMinutes();
    const second = now.getSeconds();
    
    // Exact windows: 14:00-15:20, 29:00-30:20, 44:00-45:20, 59:00-00:20
    const isPeak = (
      (minute === 14) || (minute === 15 && second <= 20) ||
      (minute === 29) || (minute === 30 && second <= 20) ||
      (minute === 44) || (minute === 45 && second <= 20) ||
      (minute === 59) || (minute === 0 && second <= 20)
    );

    // Primary engine election
    const isPrimary = !StrategyEngine.primaryWsEngineId || StrategyEngine.primaryWsEngineId === this.accountId;
    if (isPrimary) {
      StrategyEngine.primaryWsEngineId = this.accountId;
    }

    // Determine target symbols for low-bandwidth mode
    // Collect all unique active continuous contract symbols
    const activeSymbols = new Set<string>();
    if (this.accountData?.positions) {
      this.accountData.positions.forEach((p: any) => {
        if (p.symbol) activeSymbols.add(p.symbol.toLowerCase());
      });
    }
    if (this.currentPosition?.symbol) {
      activeSymbols.add(this.currentPosition.symbol.toLowerCase());
    }
    const targetSymbols = Array.from(activeSymbols);

    if (isPrimary && isPeak) {
      if (!this.isFullMarketMonitoring) {
        this.addLog('WebSocket', `[主引擎] 进入窗口监测期 (${minute}分${second}秒)，启动全市场行情订阅...`, 'info');
        await this.initMarketWs();
        this.isFullMarketMonitoring = true;
        this.lastSubscribedSymbolSet = new Set(); // Reset low-band tracker
      }
    } else {
      // Secondary engine logic or non-peak primary
      if (this.isFullMarketMonitoring) {
        this.addLog('WebSocket', `${isPrimary ? '[主引擎]' : '[从引擎]'} 离开窗口监测期 (${minute}分${second}秒)，开启低带宽模式...`, 'info');
        this.switchToLowBandwidthMonitoring(targetSymbols);
        this.isFullMarketMonitoring = false;
      } else {
        // Compare current active symbols with last subscribed
        const setsEqual = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(value => b.has(value));
        
        if (!setsEqual(this.lastSubscribedSymbolSet, activeSymbols) || (activeSymbols.size > 0 && this.marketWss.length === 0)) {
          if (activeSymbols.size > 0) {
            this.addLog('WebSocket', `[行情同步] 持仓变动，更新订阅: [${targetSymbols.join(', ')}]`, 'info');
            this.switchToLowBandwidthMonitoring(targetSymbols);
          } else if (this.marketWss.length > 0) {
            this.addLog('WebSocket', '[行情同步] 当前无持仓，关闭行情订阅', 'info');
            this.cleanupMarketWs();
            this.lastSubscribedSymbolSet = new Set();
          }
        }
      }
    }
  }

  private switchToLowBandwidthMonitoring(symbols: string[]) {
    this.cleanupMarketWs();
    this.isFullMarketMonitoring = false;
    
    if (symbols.length > 0) {
      this.addLog('WebSocket', `低带宽模式：仅维持持仓币种 [${symbols.join(', ')}] 的 15m K线订阅`, 'info');
      this.createMarketConnection(symbols, 0);
      this.lastSubscribedSymbolSet = new Set(symbols);
    } else {
      this.addLog('WebSocket', '低带宽模式：当前无持仓，已关闭行情订阅', 'info');
      this.lastSubscribedSymbolSet = new Set();
    }
  }

  private cleanupMarketWs() {
    this.marketWss.forEach(ws => {
      ws.removeAllListeners();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    });
    this.marketWss = [];
  }

  private async initMarketWs() {
    if (!this.isRunning) return;
    
    try {
      // 确保有币种信息
      if (!this.exchangeInfo) {
        this.exchangeInfo = await this.binance.getExchangeInfo();
      }

      const allSymbols = this.exchangeInfo.symbols
        .filter((s: any) => s.quoteAsset === 'USDT' && s.contractType === 'PERPETUAL' && s.status === 'TRADING')
        .map((s: any) => s.symbol.toLowerCase());

      if (allSymbols.length === 0) return;

      this.addLog('WebSocket', `正在启动市场数据连接池，总计 ${allSymbols.length} 个币种...`, 'info');

      // 清理旧连接
      this.cleanupMarketWs();

      // 分片逻辑：每 150 个币种开启一个连接 (币安单连接上限 200)
      const chunkSize = 150;
      const chunks = [];
      for (let i = 0; i < allSymbols.length; i += chunkSize) {
        chunks.push(allSymbols.slice(i, i + chunkSize));
      }

      this.addLog('WebSocket', `计划建立 ${chunks.length} 个并行连接以覆盖全市场数据`, 'info');

      // 逐个建立连接
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const connId = i + 1;
        
        // 稍微延迟启动每个连接，避免瞬时并发过高
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.createMarketConnection(chunk, connId);
      }

    } catch (error: any) {
      this.addLog('WebSocket', `初始化市场数据连接池失败: ${error.message}`, 'error');
    }
  }

  private async syncKlines() {
    // 检查全局锁定：如果已有引擎正在同步，或者 5 分钟内刚同步过，则跳过
    const now = Date.now();
    if (StrategyEngine.isGlobalSyncingKlines) {
      // 只有在调试模式或初次检测时输出，避免每个账户都刷这条日志
      return;
    }
    
    // 5 分钟冷却期，避免多账户先后启动造成重复同步
    if (now - StrategyEngine.lastGlobalSyncTime < 300000) {
      return;
    }

    StrategyEngine.isGlobalSyncingKlines = true;
    this.addLog('系统', '启动全局K线同步序列...', 'info');
    
    try {
      if (!this.exchangeInfo) {
        this.exchangeInfo = await this.binance.getExchangeInfo();
      }

      const symbols = this.exchangeInfo.symbols
        .filter((s: any) => s.quoteAsset === 'USDT' && s.contractType === 'PERPETUAL' && s.status === 'TRADING')
        .map((s: any) => s.symbol);

      this.addLog('系统', `全市场共有 ${symbols.length} 个活跃U本位永续合约，开始分批校验...`, 'info');

      const fifteenMinMs = 15 * 60 * 1000;
      const lastClosedKlineTime = Math.floor(now / fifteenMinMs) * fifteenMinMs - fifteenMinMs;

      let syncedCount = 0;
      let errorCount = 0;

      for (let i = 0; i < symbols.length; i++) {
        // 关键：如果引擎已停止，立即终止同步
        if (!this.isRunning) {
          console.log(`[${this.accountId}] syncKlines 中断：引擎已停止。`);
          break;
        }

        const symbol = symbols[i];
        
        try {
          // 检查本地最新的一条K线
          const latestLocalTime = await dbService.getLatestKlineTime(symbol, '15m');
          
          if (latestLocalTime < lastClosedKlineTime) {
            const limit = latestLocalTime === 0 ? 300 : Math.min(300, Math.ceil((lastClosedKlineTime - latestLocalTime) / fifteenMinMs));
            
            if (limit > 0) {
              const klinesData = await this.binance.getKlines(symbol, '15m', limit);
              if (Array.isArray(klinesData) && klinesData.length > 0) {
                const klines: Kline[] = klinesData.map((k: any) => {
                  const open = parseFloat(k[1]);
                  const high = parseFloat(k[2]);
                  const low = parseFloat(k[3]);
                  const close = parseFloat(k[4]);
                  return {
                    symbol,
                    interval: '15m',
                    openTime: k[0],
                    open,
                    high,
                    low,
                    close,
                    volume: parseFloat(k[5]),
                    closeTime: k[6],
                    quoteAssetVolume: parseFloat(k[7]),
                    numberOfTrades: k[8],
                    takerBuyBaseAssetVolume: parseFloat(k[9]),
                    takerBuyQuoteAssetVolume: parseFloat(k[10]),
                    change: ((close - open) / open) * 100,
                    amplitude: ((high - low) / low) * 100
                  };
                });
                
                await dbService.saveKlines(klines);
                await dbService.pruneKlines(symbol, '15m', 300);
                syncedCount++;
              }
            }
          }
        } catch (err: any) {
          errorCount++;
        }

        // 速率控制
        await new Promise(resolve => setTimeout(resolve, 200));

        if ((i + 1) % 50 === 0) {
          this.addLog('系统', `全局K线同步进度: ${i + 1}/${symbols.length} (已同步 ${syncedCount}, 错误 ${errorCount})`, 'info');
        }
      }

      StrategyEngine.lastGlobalSyncTime = Date.now();
      this.addLog('系统', `全局K线同步完成。共处理 ${symbols.length} 个币种，实际补齐 ${syncedCount} 个，错误 ${errorCount} 个`, 'success');
    } catch (err: any) {
      this.addLog('系统', `获取市场信息失败，跳过K线同步: ${err.message}`, 'error');
    } finally {
      StrategyEngine.isGlobalSyncingKlines = false;
    }
  }

  private createMarketConnection(symbols: string[], id: number) {
    if (!this.isRunning) return;

    const wsUrl = 'wss://fstream.binance.com/ws';
    const ws = new WebSocket(wsUrl);
    this.marketWss.push(ws);

    ws.on('open', () => {
      this.addLog('WebSocket', `[连接#${id}] 已建立，订阅 ${symbols.length} 个币种...`, 'success');
      
      // 发送订阅请求
      const subscribeMsg = {
        method: 'SUBSCRIBE',
        params: symbols.map(s => `${s}@kline_15m`),
        id: Date.now() + id
      };
      ws.send(JSON.stringify(subscribeMsg));

      // 启动心跳检测
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        } else {
          clearInterval(pingInterval);
        }
      }, 30000);
    });

    ws.on('message', (data: any) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.e === 'kline') {
          const symbol = msg.s;
          const k = msg.k;
          const price = parseFloat(k.c);
          // 统一存入共享缓存 Map
          StrategyEngine.globalKlineCache.set(symbol, {
            open: parseFloat(k.o),
            close: price,
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            quoteVolume: parseFloat(k.q),
            timestamp: k.t,
            isFinal: k.x
          });

          // 如果K线已收盘，持久化到数据库并剪枝
          if (k.x) {
            const open = parseFloat(k.o);
            const high = parseFloat(k.h);
            const low = parseFloat(k.l);
            const close = parseFloat(k.c);
            const kline: Kline = {
              symbol,
              interval: '15m',
              openTime: k.t,
              open,
              high,
              low,
              close,
              volume: parseFloat(k.v),
              closeTime: k.T,
              quoteAssetVolume: parseFloat(k.q),
              numberOfTrades: k.n,
              takerBuyBaseAssetVolume: parseFloat(k.V),
              takerBuyQuoteAssetVolume: parseFloat(k.Q),
              change: ((close - open) / open) * 100,
              amplitude: ((high - low) / low) * 100
            };
            
            dbService.saveKline(kline).then(() => {
              dbService.pruneKlines(symbol, '15m', 300);
            }).catch(err => {
              console.error(`Failed to save closed kline for ${symbol}:`, err);
            });
          }

          this.lastMarketDataTime = Date.now();

          // 如果当前有该币种的持仓，立即更新 accountData 并推送
          if (this.accountData && this.accountData.positions) {
            const posIndex = this.accountData.positions.findIndex((p: any) => p.symbol === symbol);
            if (posIndex !== -1) {
              this.accountData.positions[posIndex].currentPrice = price;
              if (this.onUpdate) {
                this.onUpdate('account', this.accountData);
              }
            }
          }
        }
      } catch (e) {
        // 忽略解析错误
      }
    });

    ws.on('error', (err: any) => {
      this.addLog('WebSocket', `[连接#${id}] 错误: ${err.message}`, 'error');
    });

    ws.on('close', (code, reason) => {
      // 从数组中移除
      this.marketWss = this.marketWss.filter(w => w !== ws);
      
      if (this.isRunning) {
        this.addLog('WebSocket', `[连接#${id}] 已断开 (代码: ${code})，5秒后尝试重连该分组...`, 'warning');
        setTimeout(() => {
          if (this.isRunning) {
            this.createMarketConnection(symbols, id);
          }
        }, 5000);
      }
    });
  }

  private async initWebSocket() {
    try {
      this.cleanupWs();

      this.listenKey = await this.binance.getListenKey();
      if (!this.listenKey) {
        throw new Error('无法获取 ListenKey');
      }

      const wsUrl = `${this.settings.binance.wsUrl}/${this.listenKey}`;
      this.addLog('WebSocket', `正在连接: ${this.settings.binance.wsUrl}/...`, 'info');
      
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.wsConnected = true;
        this.reconnectAttempts = 0;
        this.addLog('WebSocket', 'Binance User Data Stream 已连接', 'success');
        
        // Start keep alive every 30 minutes
        this.keepAliveInterval = setInterval(async () => {
          if (this.isRunning && this.listenKey) {
            try {
              await this.binance.keepAliveListenKey();
              this.addLog('WebSocket', 'ListenKey 续期成功', 'info');
            } catch (e: any) {
              this.addLog('WebSocket', `ListenKey 续期失败: ${e.message}`, 'error');
            }
          }
        }, 30 * 60 * 1000);

        // Start ping every 30 seconds to keep connection alive
        this.pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
              this.ws.ping();
            } catch (e) {
              this.addLog('WebSocket', 'Ping 发送失败', 'warning');
            }
          }
        }, 30000);
      });

      this.ws.on('pong', () => {
        // Pong received, connection is healthy
      });

      this.ws.on('message', (data: string) => {
        try {
          const event = JSON.parse(data);
          this.handleWsEvent(event);
        } catch (e: any) {
          this.addLog('WebSocket', `解析消息失败: ${e.message}`, 'error');
        }
      });

      this.ws.on('error', (error: any) => {
        this.wsConnected = false;
        this.addLog('WebSocket', `连接错误: ${error.message}`, 'error');
      });

      this.ws.on('close', (code, reason) => {
        this.wsConnected = false;
        this.addLog('WebSocket', `连接已关闭 (代码: ${code}, 原因: ${reason})`, 'warning');
        
        this.cleanupWs();

        if (this.isRunning) {
          const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
          this.addLog('WebSocket', `${delay / 1000}秒后尝试重新连接 (尝试次数: ${this.reconnectAttempts + 1})...`, 'info');
          setTimeout(() => {
            if (this.isRunning) {
              this.reconnectAttempts++;
              this.initWebSocket();
            }
          }, delay);
        }
      });

    } catch (error: any) {
      this.addLog('WebSocket', `初始化失败: ${error.message}`, 'error');
      if (this.isRunning) {
        setTimeout(() => {
          if (this.isRunning) this.initWebSocket();
        }, 10000);
      }
    }
  }

  private handleWsEvent(event: any) {
    // WebSocket is only used for account and order updates.
    // Real-time price market data is NOT subscribed to.
    if (event.e === 'ORDER_TRADE_UPDATE' || event.e === 'STRATEGY_ORDER_UPDATE' || event.e === 'ALGO_ORDER_UPDATE') {
      const order = event.o || event.sa || event.ao; // sa for strategy order update, ao for algo
      const symbol = order ? order.s : 'Unknown';
      
      const isFilled = order && order.X === 'FILLED';
      const isPartial = order && order.X === 'PARTIALLY_FILLED';
      
      // 增强日志：检测成交状态
      if (order && (isFilled || isPartial)) {
        const side = order.S === 'BUY' ? '买入' : '卖出';
        const type = order.o === 'MARKET' ? '市价' : (order.o === 'LIMIT' ? '限价' : '算法');
        this.addLog('订单', `[最高] binance仓单成交完成: ${symbol}, 方向: ${side}, 类型: ${type}, 数量: ${order.l}/${order.q}, 价格: ${order.L}`, 'success', event);
        
        // 推送优先：如果是 FILLED 且是平仓方向，立即判定平仓
        if (isFilled) {
          const openTrade = this.tradeLogs.find(t => t.symbol === symbol && t.status === 'OPEN');
          if (openTrade) {
            const isClosingOrder = (openTrade.side === 'BUY' && order.S === 'SELL') || (openTrade.side === 'SELL' && order.S === 'BUY');
            if (isClosingOrder) {
              this.addLog('订单', `[推送优先] 检测到平仓成交推送: ${symbol}`, 'success');
              this.confirmPositionClosed(symbol, parseFloat(order.L), order.T);
            }
          }
        }
      } else {
        this.addLog('订单', `实时推送: ${symbol} ${event.e}`, 'success', event);
      }
      
      // 优化：只有在订单完全成交 (FILLED) 时才触发清理逻辑，减少密集成交时的 API 开销
      // Scheme 2: 在内存中直接映射状态，对 UI 更新，大幅度消减 REST API 热盲查风暴
      if (this.accountData && this.accountData.openOrders) {
        const idx = this.accountData.openOrders.findIndex((ord: any) => ord.orderId === (order ? order.i : undefined));
        if (order && ['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'].includes(order.X)) {
          if (idx >= 0) this.accountData.openOrders.splice(idx, 1);
        } else if (order && idx >= 0) {
          const oo = this.accountData.openOrders[idx];
          oo.status = order.X;
          oo.executedQty = order.z;
        }
        if (this.onUpdate) this.onUpdate('account', this.accountData);
      }
      
      // 使用拉长防抖处理，由原有 800ms 放大至 3000ms，以内存状态推送为主，REST兜底为辅
      this.fetchAccountDataDebounced({ skipCleanup: !isFilled }); 
    } else if (event.e === 'ACCOUNT_UPDATE') {
      // Scheme 2: 内存中直接覆盖最新余额和持仓变化
      if (this.accountData && event.a && event.a.B) {
        const usdt = event.a.B.find((b: any) => b.a === 'USDT');
        if (usdt) {
          this.accountData.totalBalance = usdt.wb;
          this.accountData.availableBalance = usdt.cw;
          if (this.onUpdate) this.onUpdate('account', this.accountData);
        }
      }
      
      this.addLog('账户', '收到账户更新推送', 'info');
      // 依靠长防抖统一验证对账
      this.fetchAccountDataDebounced({ skipCleanup: true });
    } else if (event.e === 'listenKeyExpired') {
      this.addLog('WebSocket', 'ListenKey 已过期，正在重新连接...', 'warning');
      if (this.ws) this.ws.close();
    }
  }

  private fetchAccountDataDebounced(options: { skipCleanup?: boolean } = {}) {
    // 合并选项：如果任何一个请求要求不跳过清理，则最终执行时不跳过
    if (options.skipCleanup === false) {
      this.fetchAccountOptions.skipCleanup = false;
    } else if (this.fetchAccountOptions.skipCleanup === undefined) {
      this.fetchAccountOptions.skipCleanup = options.skipCleanup;
    }

    if (this.fetchAccountTimer) {
      return; // 已经在等待中，不需要重新计时，只需确保选项已合并
    }

    this.fetchAccountTimer = setTimeout(() => {
      const finalOptions = { ...this.fetchAccountOptions };
      this.fetchAccountOptions = {}; // 重置
      this.fetchAccountTimer = null;
      this.fetchAccountData(finalOptions);
    }, 3000); // 防抖调整至 3000ms：由方案二 WebSocket 内存同步保障实时性，缩小 REST 查证密集度
  }

  private async confirmPositionClosed(symbol: string, exitPrice?: number, exitTime?: number) {
    // 1. 记录平仓时间用于冷却期
    this.closedPositionsHistory.set(symbol, Date.now());
    this.pendingCloseSymbols.delete(symbol);

    // 2. 查找并更新交易日志
    const openTrade = this.tradeLogs.find(t => t.symbol === symbol && t.status === 'OPEN');
    if (openTrade) {
      this.addLog('订单', `[最高] binance仓单成交完成 (确认平仓): ${symbol}`, 'success');
      
      try {
        // 优化方案：如果没有传入价格（如通过轮询检测到的平仓），先尝试同步获取当前价格作为占位，防止出现 --
        let priceToUse = exitPrice;
        if (!priceToUse) {
          const currentPrice = await this.fetchCurrentPrice(symbol);
          if (currentPrice !== '--') {
            priceToUse = parseFloat(currentPrice);
          }
        }

        // 标记为已关闭
        this.updateTradeLog(openTrade.id, {
          status: 'CLOSED',
          closeTime: exitTime || Date.now(),
          exitPrice: priceToUse || openTrade.exitPrice
        });

        // 3. 异步补全成交详情
        // 延迟 2 秒获取，给币安 API 一点同步时间
        setTimeout(() => this.fetchAndFillTradeDetails(openTrade.id, symbol, openTrade.openTime), 2000);
      } catch (e: any) {
        this.addLog('系统', `确认平仓失败: ${e.message}`, 'error');
      }
    }

    // 4. 触发一次账户刷新以清理挂单
    // 这里 skipCleanup 为 false，确保清理孤立挂单
    this.fetchAccountDataDebounced({ skipCleanup: false });
  }

  async fetchCurrentPrice(symbol: string): Promise<string> {
    try {
      const ticker = await this.binance.getTickerPrice(symbol);
      return ticker.price;
    } catch (error) {
      return '--';
    }
  }

  private async sendEmail(subject: string, text: string) {
    // 邮件通知硬编码
    const emailEnabled = true; // 默认开启
    if (!emailEnabled) return;
    
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.qq.com',
        port: 465,
        secure: true,
        auth: {
          user: '67552827@qq.com', // 发送邮箱
          pass: 'qoaferkcewigbhbh', // 授权码
        },
        tls: {
          rejectUnauthorized: false // 忽略证书校验，提高兼容性
        }
      });

      await transporter.sendMail({
        from: `"${this.settings.appName || APP_NAME}" <67552827@qq.com>`,
        to: 'yyb_cq@outlook.com', // 接收邮箱
        subject,
        text,
      });
      this.addLog('邮件', `邮件发送成功: ${subject}`, 'success');
    } catch (e: any) {
      this.addLog('邮件', `邮件发送失败: ${e.message}`, 'error');
    }
  }

  private async checkWithdrawal(balance: number) {
    if (this.isWithdrawing) return;
    
    // 确保在没有持仓且没有正在执行下单逻辑时才进行转账
    if (this.accountData.positions.length > 0 || this.isOrdering) {
      return;
    }

    const { withdrawalThreshold, retentionThreshold } = this.settings.withdrawal;
    
    if (balance > withdrawalThreshold) {
      const amountToTransfer = balance - retentionThreshold;
      if (amountToTransfer > 0) {
        this.isWithdrawing = true;
        this.addLog('系统', `触发提款: 余额 ${balance} > 提款阈值 ${withdrawalThreshold}, 准备转账 ${amountToTransfer.toFixed(2)} 至现货`, 'info');
        try {
          await this.binance.transferToSpot(amountToTransfer.toFixed(2));
          this.addLog('系统', `提款成功: 已转账 ${amountToTransfer.toFixed(2)} USDT 至现货`, 'success');
          this.addTransferLog({
            id: Math.random().toString(36).substr(2, 9),
            asset: 'USDT',
            amount: amountToTransfer,
            type: 'OUT',
            status: 'SUCCESS',
            timestamp: Date.now(),
            message: '自动提款至现货'
          });
          await this.sendEmail('非常好', `转账成功！合约账户余额: ${balance.toFixed(2)}, 已转出: ${amountToTransfer.toFixed(2)} USDT 至现货账户。`);
        } catch (e: any) {
          this.addLog('系统', `提款失败: ${e.message}`, 'error');
          this.addTransferLog({
            id: Math.random().toString(36).substr(2, 9),
            asset: 'USDT',
            amount: amountToTransfer,
            type: 'OUT',
            status: 'FAILED',
            timestamp: Date.now(),
            message: `提款失败: ${e.message}`
          });
        } finally {
          this.isWithdrawing = false;
        }
      }
    }
  }

  private async checkReplenishment(balance: number) {
    const { alarmThreshold } = this.settings.withdrawal;
    if (balance < alarmThreshold) {
       const now = Date.now();
       // 1小时通知一次
       if (now - this.lastReplenishmentEmailTime > 3600000) {
         this.addLog('系统', `触发补款提醒: 余额 ${balance.toFixed(2)} < 报警阈值 ${alarmThreshold}`, 'warning');
         await this.sendEmail('请加码', `合约账户余额过低！当前余额: ${balance.toFixed(2)}, 报警阈值: ${alarmThreshold}。请尽快加码。`);
         this.lastReplenishmentEmailTime = now;
       }
    }
  }

  async fetchAccountData(options: { skipCleanup?: boolean } = {}) {
    if (this.isBanned && Date.now() < this.banUntil) return;
    if (this.isBanned && Date.now() >= this.banUntil) {
      this.isBanned = false;
    }
    
    // 强制刷新频率限制：放宽至 2000 毫秒，避免突发事件击穿
    const now = Date.now();
    if (now - this.lastAccountFetchTime < 2000) {
      return;
    }
    this.lastAccountFetchTime = now;

    try {
      // 优化：全并发请求，极大缩短等待时间
      const [account, positions, spotAccount, openOrders, openAlgoOrders] = await Promise.all([
        this.binance.getAccountInfo(),
        this.binance.getPositionRisk(),
        this.binance.getSpotAccountInfo(),
        this.binance.getOpenOrders(),
        this.binance.getOpenAlgoOrders().catch(() => []) // 容错处理
      ]);

      const activePositions = positions.filter((p: any) => {
        const amount = Math.abs(parseFloat(p.positionAmt));
        if (amount === 0) return false;

        // 计算名义价值 (使用标记价或入场价)
        const price = parseFloat(p.markPrice || p.entryPrice || '0');
        const value = amount * price;

        // 名义价值阈值法：低于 0.1 USDT 视为粉尘仓位
        if (value < 0.1) {
          if (!this.notifiedDustSymbols.has(p.symbol)) {
            this.addLog('系统', `检测到粉尘仓位: ${p.symbol}, 数量: ${p.positionAmt}, 价值: ${value.toFixed(4)} USDT. 将在逻辑中忽略此仓位并发送邮件通知。`, 'warning');
            this.sendEmail('粉尘仓位提醒', `币种: ${p.symbol}\n数量: ${p.positionAmt}\n价值: ${value.toFixed(4)} USDT\n该仓位价值低于 0.1 USDT，系统已在逻辑中将其忽略，以确保下一轮扫描和开仓能正常进行。请手动处理该残余。`)
              .catch(e => console.error('Failed to send dust email:', e));
            this.notifiedDustSymbols.add(p.symbol);
          }
          return false;
        }

        // 如果之前标记过粉尘但现在变大了（比如手动补仓了），移除标记
        if (this.notifiedDustSymbols.has(p.symbol)) {
          this.notifiedDustSymbols.delete(p.symbol);
        }
        
        return true;
      });

      // 清理已经彻底消失的粉尘标记
      const currentAllSymbols = new Set(positions.filter((p: any) => parseFloat(p.positionAmt) !== 0).map((p: any) => p.symbol));
      this.notifiedDustSymbols.forEach(sym => {
        if (!currentAllSymbols.has(sym)) {
          this.notifiedDustSymbols.delete(sym);
        }
      });

      const symbolsToCheck = new Set(this.previousPositions.map((p: any) => p.symbol as string));
      for (const sym of this.pendingCloseSymbols.keys()) {
        symbolsToCheck.add(sym);
      }
      // 检查内存中仍然标记为 OPEN 的记录，防止因重启或断联遗漏平仓状态
      this.tradeLogs.filter(t => t.status === 'OPEN').forEach(t => {
        symbolsToCheck.add(t.symbol);
      });

      // 检测仓位关闭 (通过轮询发现)
      symbolsToCheck.forEach(async symbol => {
        const current = activePositions.find((p: any) => p.symbol === symbol);
        if (!current) {
          // 1. 检查冷静期：新开仓 5 秒内不判定消失
          const openTrade = this.tradeLogs.find(t => t.symbol === symbol && t.status === 'OPEN');
          if (openTrade) {
            const age = Date.now() - openTrade.openTime;
            if (age < 5000) {
              this.addLog('系统', `检测到持仓消失但处于冷静期 (${(age/1000).toFixed(1)}s): ${symbol}, 暂不判定平仓`, 'info');
              return;
            }
          }

          // 2. 异步确认逻辑
          const count = (this.pendingCloseSymbols.get(symbol) || 0) + 1;
          if (count >= 2) {
            this.addLog('系统', `持仓轮询为空确认完成，进行平仓: ${symbol}`, 'warning');
            this.confirmPositionClosed(symbol);
          } else {
            this.pendingCloseSymbols.set(symbol, count);
            this.addLog('系统', `检测到持仓消失，进入异步确认期 (第 ${count} 次): ${symbol}`, 'info');
            // 缩短下一次刷新时间以加快确认
            setTimeout(() => this.fetchAccountData(), 2000);
          }
        }
      });

      // 如果持仓重新出现，清除待确认状态
      activePositions.forEach(p => {
        if (this.pendingCloseSymbols.has(p.symbol)) {
          this.addLog('系统', `持仓重新出现，取消平仓确认: ${p.symbol}`, 'info');
          this.pendingCloseSymbols.delete(p.symbol);
        }
      });

      this.previousPositions = activePositions;

      // 映射 Algo 订单到统一格式
      const mappedAlgoOrders = (Array.isArray(openAlgoOrders) ? openAlgoOrders : (openAlgoOrders?.orders || openAlgoOrders?.data || []))
        .map((o: any) => ({
          ...o,
          isAlgo: true,
          algoId: o.algoId || o.orderId || o.strategyId,
          orderId: o.algoId || o.orderId || o.strategyId,
          origQty: o.quantity || o.origQty || o.totalQuantity,
          price: o.price || '0',
          stopPrice: o.stopPrice || o.triggerPrice || o.activationPrice,
          type: o.algoType || o.strategyType || o.type || 'ALGO',
          time: o.time || o.updateTime || o.createTime
        }));

      const combinedOrders = [...openOrders, ...mappedAlgoOrders];

      // 幽灵仓单优化：有持仓但无任何委托单 (5秒检测)
      // 排除正在下单中的情况，以及 30 秒内新开的仓位
      const realGhostPositions = activePositions.filter(p => {
        const age = Date.now() - (p.updateTime || 0);
        return age > 30000; // 只有超过 30 秒的仓位才考虑是幽灵
      });

      if (realGhostPositions.length > 0 && combinedOrders.length === 0 && !this.isOrdering) {
        if (this.noOrdersStartTime === null) {
          this.noOrdersStartTime = Date.now();
          this.addLog('订单', '检测到有持仓但无委托单，开始 5 秒观察期...', 'warning');
          // 缩短下一次刷新时间，以便在 5 秒后能及时处理
          setTimeout(() => this.fetchAccountData(), 5000);
        } else {
          const elapsed = Date.now() - this.noOrdersStartTime;
          if (elapsed >= 5000) {
            this.addLog('订单', `检测到有持仓但无委托单已超过 5 秒 (${(elapsed/1000).toFixed(1)}s)，正在立即市价平仓...`, 'error');
            await this.closeCurrentPosition();
            this.noOrdersStartTime = null;
            // 平仓后立即再次刷新
            setTimeout(() => this.fetchAccountData(), 1000);
            return; // 提前返回，避免后续逻辑干扰
          }
        }
      } else {
        this.noOrdersStartTime = null;
      }

      const totalBalance = account.totalWalletBalance || '0.00';
      const availableBalance = account.availableBalance || '0.00';
      
      // 获取现货 USDT 余额
      let spotBalance = '0.00';
      if (spotAccount && spotAccount.balances) {
        const usdtBalance = spotAccount.balances.find((b: any) => b.asset === 'USDT');
        if (usdtBalance) {
          spotBalance = (parseFloat(usdtBalance.free) + parseFloat(usdtBalance.locked)).toFixed(2);
        }
      }

      this.accountData = {
        totalBalance,
        availableBalance,
        spotBalance,
        positions: activePositions.map((p: any) => {
          const amount = parseFloat(p.positionAmt);
          const entryPrice = parseFloat(p.entryPrice);
          const kline = this.getCachedKline(p.symbol);
          return {
            ...p,
            entryValue: (Math.abs(amount) * entryPrice).toFixed(2),
            currentPrice: kline ? kline.close : (p.markPrice ? parseFloat(p.markPrice) : null)
          };
        }),
        openOrders: combinedOrders
      };

      // 余额阈值检测
      const balance = parseFloat(totalBalance);
      const threshold = this.settings.withdrawal.alarmThreshold;
      const emailEnabled = true; // 默认开启
      if (emailEnabled && balance < threshold) {
        if (!this.balanceAlertSent) {
          this.balanceAlertSent = true;
          this.addLog('系统', `余额提醒: 当前总余额 (${balance}) 低于设定阈值 (${threshold})`, 'warning');
          this.addLog('邮件', `准备发送余额提醒邮件至: yyb_cq@outlook.com`, 'info');
          await this.sendEmail('余额提醒', `当前总余额 (${balance.toFixed(2)}) 低于设定阈值 (${threshold})，请注意。`);
        }
      } else if (balance >= threshold) {
        this.balanceAlertSent = false;
      }

      // 孤立资源清理逻辑 (Orphan Cleanup)
      if (!this.isOrdering && !this.isCancelling && !options.skipCleanup) {
        const positionSymbols = new Set(activePositions.map(p => p.symbol));
        const ordersToCancel: any[] = [];
        
        // 1. 收集孤立挂单：没有持仓的币种不应该有挂单
        const orphanOrders = combinedOrders.filter(o => !positionSymbols.has(o.symbol));
        if (orphanOrders.length > 0) {
          this.addLog('清理', `检测到孤立挂单: ${Array.from(new Set(orphanOrders.map(o => o.symbol))).join(', ')}，准备清理...`, 'warning');
          ordersToCancel.push(...orphanOrders);
        }

        // 2. 收集重复挂单：每个持仓币种只能有一个 Limit 和一个 Algo 委托单
        for (const symbol of positionSymbols) {
          const symbolOrders = combinedOrders.filter(o => o.symbol === symbol);
          
          // 显式按时间排序 (升序)，确保索引 0 是最早的订单
          const limitOrders = symbolOrders
            .filter(o => !o.isAlgo)
            .sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
            
          const algoOrders = symbolOrders
            .filter(o => o.isAlgo)
            .sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));

          if (limitOrders.length > 1) {
            const redundant = limitOrders.slice(1);
            this.addLog('清理', `检测到 ${symbol} 有多个 Limit 挂单 (${limitOrders.length})，将清理 ${redundant.length} 个冗余订单，保留最早的一张。`, 'warning');
            ordersToCancel.push(...redundant);
          }

          if (algoOrders.length > 1) {
            const redundant = algoOrders.slice(1);
            this.addLog('清理', `检测到 ${symbol} 有多个 Algo 挂单 (${algoOrders.length})，将清理 ${redundant.length} 个冗余订单，保留最早的一张。`, 'warning');
            ordersToCancel.push(...redundant);
          }
        }

        // 3. 执行统一撤单
        if (ordersToCancel.length > 0) {
          await this.cancelAllOrdersSequentially(ordersToCancel);
        }

        // 4. 清理多余持仓：系统设计为单仓位，多出的仓位需平掉
        if (activePositions.length > 1) {
          const primarySymbol = this.currentPosition?.symbol || activePositions[0].symbol;
          const extraPositions = activePositions.filter(p => p.symbol !== primarySymbol);
          
          for (const pos of extraPositions) {
            this.addLog('清理', `检测到多余持仓: ${pos.symbol}，正在强制平仓...`, 'error');
            await this.closeSpecificPosition(pos);
          }
          setTimeout(() => this.fetchAccountData(), 1000);
        }
      }

      // 当无持仓且无挂单时，执行补提款检测 (转账操作只能在没有正向单持仓的时候发生)
      // 优化：仅在“自动补全交易详情”成功后触发检查，避免频繁提示
      if (activePositions.length === 0 && combinedOrders.length === 0 && !this.isOrdering) {
        if (this.shouldCheckTransfer) {
          if (this.emptyAccountStartTime === null) {
            this.emptyAccountStartTime = Date.now();
            this.addLog('划转', '检测到账户已清空，开始 5 秒划转观察期...', 'info');
            // 缩短下一次刷新时间，以便在 5 秒后能及时处理
            setTimeout(() => this.fetchAccountData(), 5000);
          } else {
            const elapsed = Date.now() - this.emptyAccountStartTime;
            if (elapsed >= 5000) {
              await this.checkWithdrawal(balance);
              await this.checkReplenishment(balance);
              this.emptyAccountStartTime = null; // 执行后重置
              this.shouldCheckTransfer = false; // 执行后重置
            }
          }
        }
      } else {
        if (this.emptyAccountStartTime !== null) {
          this.addLog('划转', '检测到新活动，取消划转观察期', 'info');
        }
        this.emptyAccountStartTime = null;
        this.shouldCheckTransfer = false; // 如果账户不为空，重置触发标记
      }

      if (activePositions.length > 0) {
        const p = activePositions[0];
        
        // 优先从本地交易日志中查找真实的开仓时间，以防止重启后 updateTime 被交易所刷新（如调整杠杆等）
        const localTrade = this.tradeLogs.find(t => t.symbol === p.symbol && t.status === 'OPEN');
        const openTime = localTrade ? localTrade.openTime : (p.updateTime || Date.now());

        this.currentPosition = {
          symbol: p.symbol,
          amount: parseFloat(p.positionAmt),
          entryPrice: parseFloat(p.entryPrice),
          side: parseFloat(p.positionAmt) > 0 ? 'BUY' : 'SELL',
          timestamp: openTime
        };
      } else {
        this.currentPosition = null;
      }

      if (this.onUpdate) {
        this.onUpdate('account', this.accountData);
      }

      return this.accountData;
    } catch (error: any) {
      if (error.message.includes('Too many requests') || error.status === 429 || error.message.includes('-1003')) {
        this.addLog('系统', '检测到频率限制 (429/Too many requests)，暂停 API 请求 30 秒', 'error');
        this.isBanned = true;
        this.banUntil = Date.now() + 30000;
      }
      
      if (error.status === 401) {
        this.addLog('账户', '获取账户数据失败: API Key 或 Secret Key 无效，请检查设置', 'error');
      } else {
        this.addLog('账户', `获取账户数据失败: ${error.message}`, 'error');
      }
    }
  }

  private async cancelAllOrdersSequentially(orders: any[]) {
    if (this.isCancelling) return;
    this.isCancelling = true;

    try {
      const limitOrders = orders.filter(o => !o.isAlgo);
      const algoOrders = orders.filter(o => o.isAlgo);

      // 1. 撤销 Limit 委托单
      for (const order of limitOrders) {
        try {
          await this.binance.cancelOrder(order.symbol, order.orderId);
          this.addLog('订单', `[最高] 撤单请求已发送: ${order.symbol} (${order.orderId}), 类型: 普通单`, 'success');
        } catch (e: any) {
          // 如果返回 -2011 (Unknown order)，说明订单已经不存在（可能已撤销或成交），视为成功
          if (e.message.includes('-2011') || e.message.includes('Unknown order')) {
            this.addLog('订单', `[最高] 撤单完成: ${order.symbol} (${order.orderId}), 类型: 普通单 (订单已不存在)`, 'success');
          } else {
            this.addLog('订单', `撤销普通单失败 (${order.symbol}): ${e.message}`, 'error');
          }
        }
      }

      // 2. 撤销 Algo 委托单
      for (const order of algoOrders) {
        try {
          await this.binance.cancelAlgoOrder(order.symbol, order.algoId || order.orderId);
          this.addLog('订单', `[最高] 撤单请求已发送: ${order.symbol} (${order.algoId || order.orderId}), 类型: 算法单`, 'success');
        } catch (e: any) {
          // 如果返回 -2011 (Unknown order)，说明订单已经不存在，视为成功
          if (e.message.includes('-2011') || e.message.includes('Unknown order')) {
            this.addLog('订单', `[最高] 撤单完成: ${order.symbol} (${order.algoId || order.orderId}), 类型: 算法单 (订单已不存在)`, 'success');
          } else {
            this.addLog('订单', `撤销算法单失败 (${order.symbol}): ${e.message}`, 'error');
          }
        }
      }
    } finally {
      this.isCancelling = false;
      // 撤单完成后 2 秒自动刷新账户数据
      setTimeout(() => this.fetchAccountData(), 2000);
    }
  }

  async forceScan(stage: number) {
    if (this.isBanned) {
      this.addLog('系统', `IP 封禁中，无法执行强制扫描 (预计解封: ${new Date(this.banUntil).toLocaleString()})`, 'warning');
      return;
    }
    this.addLog('系统', `手动触发 Stage ${stage} 扫描...`, 'info');
    switch (stage) {
      case 0: await this.runStage0(); break;
      case 1: await this.runStage0P(); break;
      case 2: await this.runStage1(); break;
      case 3: await this.runStage2(true); break;
      default: this.addLog('系统', `无效的 Stage: ${stage}`, 'error');
    }
  }

  async checkApiStatus() {
    if (this.isBanned) {
      return { api: 'error', ws: this.wsConnected ? 'ok' : 'error', error: `IP 封禁中 (预计解封: ${new Date(this.banUntil).toLocaleString()})` };
    }

    this.addLog('系统', '正在检测 API 和 WebSocket 状态...', 'info');
    try {
      const startTime = Date.now();
      await this.binance.getExchangeInfo();
      const latency = Date.now() - startTime;
      this.apiConnected = true;
      this.addLog('系统', `API 状态正常 (延迟: ${latency}ms)`, 'success');
      return { api: 'ok', ws: this.wsConnected ? 'ok' : 'error', latency };
    } catch (error: any) {
      this.apiConnected = false;
      this.addLog('系统', `API 检测失败: ${error.message}`, 'error');
      
      // 处理封禁
      if (error.status === 429 || error.status === 418) {
        this.handleBan(error);
      }
      
      return { api: 'error', ws: this.wsConnected ? 'ok' : 'error', error: error.message };
    }
  }

  /**
   * 处理币安 IP 封禁或限频
   */
  private async handleBan(error: any) {
    let retryAfter = 0;
    
    // 1. 从 Header 获取 Retry-After (秒)
    if (error.headers && error.headers['retry-after']) {
      retryAfter = parseInt(error.headers['retry-after']) * 1000;
    }

    // 2. 从 Body 获取截止时间戳 (毫秒)
    // 币安报文示例: {"code":-1003,"msg":"Way too many requests; IP banned until 1681056000000."}
    if (error.data && error.data.msg && error.data.msg.includes('until')) {
      const match = error.data.msg.match(/until (\d+)/);
      if (match) {
        const untilTs = parseInt(match[1]);
        const waitMs = untilTs - Date.now();
        if (waitMs > retryAfter) retryAfter = waitMs;
      }
    }

    // 如果无法获取具体时间，默认等待 10 分钟
    if (retryAfter <= 0) {
      retryAfter = 600000;
    }

    // 封禁截止时间后 1 分钟再启动
    const totalWait = retryAfter + 60000;
    this.banUntil = Date.now() + totalWait;
    this.isBanned = true;
    
    this.addLog('系统', `检测到 IP 被封禁或限频！状态码: ${error.status}. 预计解封时间: ${new Date(this.banUntil).toLocaleString()}`, 'error');
    
    // 立即停止策略
    this.stop();
    
    // 发送邮件通知
    this.sendEmail("接口", "接口").catch(e => console.error("Failed to send ban email:", e));

    // 计划自动重启
    setTimeout(() => {
      this.isBanned = false;
      this.banUntil = 0;
      this.addLog('系统', '封禁保护期已过，正在尝试自动重新启动策略...', 'success');
      this.start().catch(e => this.addLog('系统', `自动重启失败: ${e.message}`, 'error'));
    }, totalWait);
  }

  private async syncTime() {
    try {
      const serverTime = await this.binance.getServerTime();
      const localTime = Date.now();
      this.timeOffset = serverTime - localTime;
      this.lastTimeSyncTime = localTime;
      this.addLog('系统', `时间同步成功: 偏移量 ${this.timeOffset}ms`, 'info');
    } catch (error: any) {
      this.addLog('系统', `时间同步失败: ${error.message}`, 'error');
    }
  }

  private async runLoop() {
    while (this.isRunning) {
      try {
        await this.checkAndScan();
        
        const now = Date.now();
        const hasPosition = this.accountData.positions.length > 0;
        
        // 检查每小时 18 分记录余额
        this.checkAndRecordBalance();

        // 检查持仓超时
        if (hasPosition) {
          await this.checkPositionTimeout();
        }
        
        // 动态轮询频率(方案2补充保障)：有仓位延缓至 15 秒一次，无仓位 60 秒一次 (主业务响应现已交由 WebSocket 实时触发无缝衔接)
        const pollInterval = hasPosition ? 15000 : 60000;
        if (now - this.lastAccountFetchTime > pollInterval) {
          this.fetchAccountData();
        }

        // 行情心跳检测：如果超过 15 秒没有收到任何行情推送，且有持仓，强制刷新一次账户数据
        if (hasPosition && now - this.lastMarketDataTime > 15000) {
          // 这个既然是正常的，就不用在日志中展示了
          // this.addLog('WebSocket', '检测到行情推送停滞，强制刷新账户数据', 'warning');
          this.lastMarketDataTime = now; // 重置计时，避免连续触发
          this.fetchAccountData();
        }

        // 时间同步 (30 分钟一次)
        if (now - this.lastTimeSyncTime > 1800000) {
          this.syncTime();
        }

        // API 状态检测保持较低频率 (5 分钟一次)
        if (now - this.lastApiCheckTime > 300000) {
          this.lastApiCheckTime = now;
          this.checkApiStatus();
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        this.addLog('系统', `运行循环错误: ${error.message}`, 'error');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  private async checkPositionTimeout() {
    if (this.isBanned || !this.currentPosition || !this.settings.order.maxHoldTime || this.isClosing) return;

    const symbol = this.currentPosition.symbol;
    if (this.lockingSymbols.has(symbol)) return;

    const now = Date.now() + this.timeOffset;
    const holdTimeMs = now - this.currentPosition.timestamp;
    const maxHoldTimeMs = this.settings.order.maxHoldTime * 60 * 1000;

    if (holdTimeMs >= maxHoldTimeMs) {
      this.addLog('策略', `持仓时间已达上限 (${this.settings.order.maxHoldTime} 分钟)，正在强制平仓并撤销所有订单: ${symbol}`, 'warning');
      await this.closeCurrentPosition();
    }
  }

  private async closeSpecificPosition(pos: any) {
    try {
      const symbol = pos.symbol;
      const amount = parseFloat(pos.positionAmt);
      const closeSide = amount > 0 ? 'SELL' : 'BUY';
      
      this.addLog('清理', `执行孤立仓位平仓: ${symbol}, 数量: ${Math.abs(amount)}`, 'info');
      
      await this.binance.placeOrder({
        symbol,
        side: closeSide,
        type: 'MARKET',
        quantity: Math.abs(amount).toString(),
        reduceOnly: 'true'
      });

      this.addLog('清理', `[最高] 孤立仓位平仓完成: ${symbol}`, 'success');
    } catch (error: any) {
      this.addLog('清理', `孤立仓位平仓失败 (${pos.symbol}): ${error.message}`, 'error');
    }
  }

  private async closeCurrentPosition() {
    if (!this.currentPosition || this.isClosing) return;
    const { symbol, amount, side } = this.currentPosition;
    
    if (this.lockingSymbols.has(symbol)) return;
    
    this.isClosing = true;
    this.lockingSymbols.add(symbol);

    try {
      const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
      this.addLog('下单', `执行强制平仓流程: ${symbol}, 方向: ${closeSide}, 数量: ${Math.abs(amount)}`, 'info');
      
      // 1. 撤销该币种所有订单 (包括普通单和算法单)
      // 按照建议：先撤单，再平仓
      try {
        this.addLog('清理', `正在撤销 ${symbol} 的所有委托单...`, 'info');
        
        // 撤销普通单
        try {
          await this.binance.cancelAllOpenOrders(symbol);
          this.addLog('清理', `${symbol} 普通委托单撤销请求已发送`, 'success');
        } catch (e: any) {
          if (e.message.includes('-2011') || e.message.includes('Unknown order')) {
            this.addLog('清理', `${symbol} 无需撤销普通单 (订单已不存在)`, 'info');
          } else {
            throw e;
          }
        }

        // 撤销算法单
        const algoOrders = this.accountData.openOrders.filter((o: any) => o.symbol === symbol && o.isAlgo);
        if (algoOrders.length > 0) {
          this.addLog('清理', `检测到 ${algoOrders.length} 个算法单，正在逐一撤销...`, 'info');
          for (const o of algoOrders) {
            try {
              await this.binance.cancelAlgoOrder(symbol, o.algoId || o.orderId);
            } catch (ae: any) {
              if (!ae.message.includes('-2011') && !ae.message.includes('Unknown order')) {
                this.addLog('清理', `撤销算法单失败: ${ae.message}`, 'warning');
              }
            }
          }
          this.addLog('清理', `${symbol} 算法单清理完成`, 'success');
        }
      } catch (e: any) {
        this.addLog('清理', `平仓前撤单出现异常 (将继续尝试平仓): ${e.message}`, 'warning');
      }
      
      // 2. 下市价平仓单
      try {
        await this.binance.placeOrder({
          symbol,
          side: closeSide,
          type: 'MARKET',
          quantity: Math.abs(amount).toString(),
          reduceOnly: 'true'
        });
        this.addLog('下单', `[最高] binance仓单成交完成 (强制平仓成功): ${symbol}`, 'success');
      } catch (e: any) {
        // 如果报错 -2022 (ReduceOnly rejected)，通常意味着仓位已经没了
        if (e.message.includes('-2022') || e.message.includes('ReduceOnly')) {
          this.addLog('下单', `平仓单被拒绝: ${symbol} (可能仓位已在服务器端关闭)`, 'warning');
          // 既然仓位可能没了，我们标记为已关闭
          this.confirmPositionClosed(symbol);
        } else {
          throw e;
        }
      }
      
      // 3. 强制同步账户数据并等待
      this.addLog('系统', `正在强制同步账户数据以确认状态...`, 'info');
      await this.fetchAccountData();
      
    } catch (error: any) {
      this.addLog('下单', `强制平仓流程失败: ${error.message}`, 'error');
    } finally {
      this.isClosing = false;
      // 延迟一小段时间再移除锁定，确保数据推送已处理
      setTimeout(() => {
        this.lockingSymbols.delete(symbol);
      }, 3000);
    }
  }

  private async updateFundingFees(specificId?: string) {
    // 查找状态为 CLOSED 且查询次数少于 2 次的订单
    // 只有当资金费为 0 时才继续查询（如果已经有资金费了，说明已经匹配到了）
    const pendingLogs = this.tradeLogs.filter(log => {
      // 如果已经有资金费了（非0），说明已经匹配成功，不需要再查
      if (log.fundingFee !== 0) return false;
      
      if (specificId) return log.id === specificId && log.status === 'CLOSED' && (log.fundingFeeCheckedCount || 0) < 2;
      return log.status === 'CLOSED' && (log.fundingFeeCheckedCount || 0) < 2;
    });

    if (pendingLogs.length === 0) return;

    if (!specificId) {
      this.addLog('系统', `正在检查 ${pendingLogs.length} 个订单的资金费...`, 'info');
    }

    for (const log of pendingLogs) {
      try {
        const currentCount = (log.fundingFeeCheckedCount || 0) + 1;
        
        // 查询资金费流水
        const income = await this.binance.getIncomeHistory({
          symbol: log.symbol,
          incomeType: 'FUNDING_FEE',
          startTime: log.openTime - 1000,
          endTime: log.closeTime + 1000
        });

        let totalFundingFee = 0;
        if (Array.isArray(income) && income.length > 0) {
          totalFundingFee = income.reduce((sum, item) => sum + parseFloat(item.income), 0);
          this.addLog('系统', `订单 ${log.id} (${log.symbol}) 匹配到资金费: ${totalFundingFee.toFixed(4)} USDT`, 'success');
        }

        // 更新日志
        const contractValue = log.amount * log.entryPrice;
        const newProfitRate = contractValue > 0 ? ((log.pnl + totalFundingFee) / contractValue) * 100 : log.profitRate;

        this.updateTradeLog(log.id, {
          fundingFee: totalFundingFee,
          fundingFeeCheckedCount: currentCount,
          profitRate: newProfitRate
        });

        // 稍微停顿，避免触发频率限制
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error: any) {
        console.error(`Failed to update funding fee for ${log.id}:`, error.message);
      }
    }
  }

  /**
   * 自动补全交易详情 (用于处理同步延迟或 API 临时失败)
   */
  private async fetchAndFillTradeDetails(logId: string, symbol: string, openTime: number, retryCount: number = 0) {
    try {
      // 如果重试次数过多，停止
      if (retryCount > 3) {
        this.addLog('系统', `补全交易详情失败次数过多，停止重试: ${symbol}`, 'warning');
        return;
      }

      const log = this.tradeLogs.find(l => l.id === logId);
      if (!log) return;

      // 优化：从开仓时间开始获取该币种的最大 1000 条成交记录，确保能同时涵盖开仓手续费和平仓明细
      const startTime = openTime > 2000 ? openTime - 2000 : undefined;
      const trades = await this.binance.getUserTrades(symbol, 1000, startTime);
      const relevantTrades = trades.filter((t: any) => t.time >= (openTime - 2000));
      
      if (relevantTrades.length === 0) {
        // 如果没查到，可能是币安还没同步，10秒后重试
        this.addLog('系统', `未发现成交详情: ${symbol}, 将在10秒后进行第 ${retryCount + 1} 次重试...`, 'info');
        setTimeout(() => this.fetchAndFillTradeDetails(logId, symbol, openTime, retryCount + 1), 10000);
        return;
      }

      let totalPnl = 0;
      let totalFee = 0;
      let exitTime = 0;
      
      let totalExitQty = 0;
      let totalExitValue = 0;
      
      // 确定平仓方向，做多开仓 BUY 对应 SELL 平仓，做空开仓 SELL 对应 BUY 平仓
      const closeSide = log.side === 'BUY' ? 'SELL' : 'BUY';

      // 确保按照时间升序排列
      relevantTrades.sort((a: any, b: any) => a.time - b.time);

      let currentPositionSize = 0;
      let hasOpened = false;

      for (const t of relevantTrades) {
        const qty = parseFloat(t.qty || '0');
        
        if (t.side === log.side) {
          currentPositionSize += qty;
          hasOpened = true;
        } else if (t.side === closeSide) {
          currentPositionSize -= qty;
        }

        totalPnl += parseFloat(t.realizedPnl || '0');
        totalFee += parseFloat(t.commission || '0');
        
        // 寻找反向单作为平仓单
        if (t.side === closeSide) {
          const price = parseFloat(t.price || '0');
          totalExitQty += qty;
          totalExitValue += qty * price;
          exitTime = Math.max(exitTime, t.time);
        }

        // 以非常微小的阈值判定是否完全平仓，避免浮点数精度问题
        if (hasOpened && currentPositionSize <= 0.0000001) {
          break; // 当前周期计算完毕，退出循环（防止混合到下一次的交易记录中）
        }
      }
      
      // 优化：计算多笔分散平仓成交的加权平均平仓价
      let exitPrice = 0;
      if (totalExitQty > 0) {
        exitPrice = totalExitValue / totalExitQty;
      }

      const contractValue = log.amount * log.entryPrice;
      const profitRate = contractValue > 0 ? (totalPnl / contractValue) * 100 : 0;

      this.updateTradeLog(logId, {
        exitPrice: exitPrice || log.exitPrice,
        pnl: totalPnl,
        fee: totalFee,
        profitRate,
        closeTime: exitTime || Date.now(),
        status: 'CLOSED'
      });
      
      this.addLog('系统', `自动补全交易详情成功: ${symbol} (ID: ${logId})`, 'success');
      
      // 补全详情后，触发一次划转检测
      this.shouldCheckTransfer = true;
      
      // 补全详情后，顺便查一下资金费
      setTimeout(() => this.updateFundingFees(logId), 5000);
    } catch (error: any) {
      this.addLog('系统', `自动补全交易详情异常: ${error.message}, 10秒后重试...`, 'error');
      setTimeout(() => this.fetchAndFillTradeDetails(logId, symbol, openTime, retryCount + 1), 10000);
    }
  }

  private async checkAndScan() {
    if (this.isBanned) return;

    // 动态管理 WebSocket 订阅窗口
    await this.manageMarketDataStreams();

    const now = new Date(Date.now() + this.timeOffset);
    // Align with UTC+8 for scheduling (startTime "00:00:00" will mean 8 AM UTC / 0 AM CST)
    const totalMs = now.getTime() + 8 * 3600 * 1000;
    
    // Helper to parse "HH:mm:ss.SSS" into ms offset
    const parseTimeToMs = (timeStr: string) => {
      const [hms, msPart] = timeStr.split('.');
      const [h, m, s] = hms.split(':').map(Number);
      return ((h * 3600 + m * 60 + s) * 1000) + Number(msPart || 0);
    };

    // Helper to parse "15m", "1h", "1d" into ms
    const parseIntervalToMs = (intervalStr: string) => {
      const value = parseInt(intervalStr);
      const unit = intervalStr.slice(-1);
      if (unit === 'm') return value * 60 * 1000;
      if (unit === 'h') return value * 60 * 60 * 1000;
      if (unit === 'd') return value * 24 * 60 * 60 * 1000;
      return 15 * 60 * 1000;
    };

    const shouldRun = (settings: any, lastRunKey: string) => {
      const intervalMs = parseIntervalToMs(settings.interval);
      const targetOffsetMs = parseTimeToMs(settings.startTime) % intervalMs;
      
      // Current offset in the current interval (aligned with UTC/Epoch)
      const currentOffsetMs = totalMs % intervalMs;
      
      // 使用更小的窗口 (200ms) 并确保在目标时间之后触发，以提高精确度
      const window = 200; 
      const diff = currentOffsetMs - targetOffsetMs;
      
      // 处理跨周期的情况 (虽然通常不会发生，因为 loop 很快)
      if (diff >= 0 && diff < window) {
        const lastRun = (this as any)[lastRunKey] || 0;
        if (totalMs - lastRun > intervalMs / 2) {
          (this as any)[lastRunKey] = totalMs;
          return true;
        }
      }
      return false;
    };

    // Stage 0: 初筛 & Stage 0P: 波动率过滤
    if (this.externalMarketSource) {
      const extS0 = this.externalMarketSource.getStage0Results();
      const extS0P = this.externalMarketSource.getStage0PResults();
      if (extS0 && extS0.startTime > this.stage0Results.startTime) {
        this.stage0Results = extS0;
      }
      if (extS0P && extS0P.startTime > this.stage0PResults.startTime) {
        this.stage0PResults = extS0P;
      }
    } else {
      if (shouldRun(this.settings.scanner.stage0, 'lastS0Run')) {
        await this.runStage0();
      }

      if (shouldRun(this.settings.scanner.stage0P, 'lastS0PRun')) {
        await this.runStage0P();
      }
    }

    // Stage 1: 基础过滤
    if (shouldRun(this.settings.scanner.stage1, 'lastS1Run')) {
      await this.runStage1();
    }

    // Stage 2: 实时形态锁定
    if (shouldRun(this.settings.scanner.stage2, 'lastS2Run')) {
      await this.runStage2();
    }
  }

  private isCurrentTimeEnabled(): boolean {
    if (!this.settings.scanner.timeControl?.enabled) return true;
    
    // 强制使用北京时间 (UTC+8) 进行时段判断，确保与日志和用户预期一致
    const now = new Date();
    const beijingTimeMs = now.getTime() + 8 * 3600000;
    const mode = this.settings.scanner.timeControl.mode || '+2';
    
    let adjustedTimeMs;
    if (mode === '+2') {
      // +2 模式: 10:02:00 - 11:02:00 属于 10 时段
      adjustedTimeMs = beijingTimeMs - 120000;
    } else {
      // -2 模式: 09:58:00 - 10:58:00 属于 10 时段
      adjustedTimeMs = beijingTimeMs + 120000;
    }
    
    const adjustedDate = new Date(adjustedTimeMs);
    const slot = adjustedDate.getUTCHours();
    
    return this.settings.scanner.timeControl.hours[slot] ?? true;
  }

  private async runStage0() {
    if (!this.isCurrentTimeEnabled()) {
      this.addLog('扫描', '当前处于非工作时段，跳过 Stage 0 扫描', 'info');
      return;
    }
    const startTime = Date.now();
    const startTimeStr = new Date(startTime + 8 * 3600 * 1000).toISOString().split('T')[1].replace('Z', '');
    this.addLog('扫描', `开始 Stage 0 全市场初筛... [启动时间: ${startTimeStr}]`);
    try {
      const exchangeInfo = await this.binance.getExchangeInfo();
      const { minKlines, maxKlines, includeTradFi } = this.settings.scanner.stage0;
      const now = Date.now();
      
      // 15分钟K线毫秒数
      const klineMs = 15 * 60 * 1000;

      const filteredSymbols = exchangeInfo.symbols.filter((s: any) => {
        // 基础过滤
        if (s.quoteAsset !== 'USDT' || s.contractType !== 'PERPETUAL' || s.status !== 'TRADING') {
          return false;
        }

        // TradFi 过滤
        if (!includeTradFi && s.underlyingSubType && s.underlyingSubType.includes('TRADFI')) {
          return false;
        }

        // 上线时长过滤 (K线数量)
        // onboardDate 是上线时间戳（毫秒）
        const ageInMs = now - s.onboardDate;
        const ageInKlines = Math.floor(ageInMs / klineMs);

        return ageInKlines >= minKlines && ageInKlines <= maxKlines;
      });

      const duration = Date.now() - startTime;
      this.stage0Results = {
        data: filteredSymbols.map((s: any) => {
          const ageInKlines = Math.floor((now - s.onboardDate) / klineMs);
          return {
            symbol: s.symbol,
            age: ageInKlines,
            volume: '--',
            change: '--',
            status: 'Stage 0 Pass',
            reason: '符合初筛'
          };
        }),
        scannedCount: exchangeInfo.symbols.length,
        startTime,
        duration
      };

      this.addLog('扫描', `Stage 0 完成，筛选出 ${filteredSymbols.length} 个币种，耗时 ${duration}ms`);
    } catch (error: any) {
      this.addLog('扫描', `Stage 0 失败: ${error.message}`, 'error');
    }
  }

  private async runStage0P() {
    if (!this.isCurrentTimeEnabled()) {
      this.addLog('扫描', '当前处于非工作时段，跳过 Stage 0P 扫描', 'info');
      return;
    }
    const startTime = Date.now();
    const startTimeStr = new Date(startTime + 8 * 3600 * 1000).toISOString().split('T')[1].replace('Z', '');
    this.addLog('扫描', `开始 Stage 0P 波动率过滤... [启动时间: ${startTimeStr}]`);
    const symbols = this.stage0Results.data;
    const scannedCount = symbols.length;

    if (!this.settings.scanner.stage0P.enabled) {
      this.addLog('扫描', '波动率过滤总开关已关闭，直接跳过并传递初筛结果');
      this.stage0PResults = {
        data: [...symbols].map(r => ({ ...r, status: 'Stage 0P Skip' })),
        scannedCount,
        startTime,
        duration: Date.now() - startTime
      };
      return;
    }

    const periods = this.settings.scanner.stage0P.periods;
    const activePeriods = Object.entries(periods).filter(([_, p]: [string, any]) => p.enabled);
    const abMoveCfg = this.settings.scanner.stage0P.abnormalMove;

    if (activePeriods.length === 0 && (!abMoveCfg || !abMoveCfg.enabled)) {
      this.addLog('扫描', '未开启任何波动率周期过滤或异动监控，直接跳过并传递初筛结果');
      this.stage0PResults = {
        data: [...symbols].map(r => ({ ...r, status: 'Stage 0P Skip' })),
        scannedCount,
        startTime,
        duration: Date.now() - startTime
      };
      return;
    }

    const filteredData: any[] = [];
    const batchSize = 10; // 每批处理10个币种，避免触发频率限制
    
    const checkDesc = [
      activePeriods.length > 0 ? `周期过滤: ${activePeriods.map(([k]) => k).join(', ')}` : '',
      (abMoveCfg && abMoveCfg.enabled) ? '异动监控: 开启' : ''
    ].filter(Boolean).join(' | ');

    this.addLog('扫描', `正在进行 Stage 0P 检查 (${checkDesc})，共 ${symbols.length} 个币种`);

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(async (item) => {
        try {
          let allPassed = true;
          const volatilityInfo: any = {};
          const abMoveCfg = this.settings.scanner.stage0P.abnormalMove;

          // 1. 连续红动能过滤 (原有逻辑)
          for (const [period, config] of activePeriods as [string, any][]) {
            // 从本地数据库获取K线数据
            const closedKlines = await dbService.getKlines(item.symbol, period, config.count);
            
            if (closedKlines.length < config.count) {
              allPassed = false;
              break;
            }

            // 计算每一根 K 线的涨跌幅 (使用数据库中预计算好的字段)
            const candleVolatilities = closedKlines.map((k: any) => k.change);

            // 过滤标准：每一组计算出来的所有数据都不低于参考值才通过
            const periodPassed = candleVolatilities.every(v => v >= config.threshold);
            
            volatilityInfo[period] = candleVolatilities.map(v => v.toFixed(2) + '%').join(' | ');

            if (!periodPassed) {
              allPassed = false;
              break;
            }
          }

          if (!allPassed) return null;

          // 2. 异动监控 (新增滑动窗口逻辑)
          if (abMoveCfg && abMoveCfg.enabled) {
            // 考察 10 小时的数据 (15m K线需要 40 根)
            // 1 小时窗口大约需要 4 根 15m K线
            const lookbackCount = Math.ceil(abMoveCfg.lookbackHours * 60 / 15);
            const windowCount = Math.ceil(abMoveCfg.windowMinutes / 15);
            
            // 获取足够的K线以支撑滑动窗口
            const historyKlines = await dbService.getKlines(item.symbol, '15m', lookbackCount + windowCount);
            // 注意：dbService.getKlines 返回的是 DESC 排序 (最新在前)，计算时建议翻转为时间正序
            const klinesAsc = [...historyKlines].reverse();

            if (klinesAsc.length < lookbackCount) {
               // 数据不足时不予通过，或者你可以选择跳过检查
               return null;
            }

            for (let j = 0; j <= klinesAsc.length - windowCount; j++) {
              const windowOpen = klinesAsc[j].open;
              const windowClose = klinesAsc[j + windowCount - 1].close;
              const windowChange = ((windowClose - windowOpen) / windowOpen) * 100;

              if (windowChange > abMoveCfg.maxPump) {
                this.addLog('扫描', `${item.symbol} 异动拦截: 滑动窗口(约${abMoveCfg.windowMinutes}min)涨幅 ${windowChange.toFixed(2)}% > ${abMoveCfg.maxPump}%`, 'warning');
                allPassed = false;
                break;
              }
              if (windowChange < -abMoveCfg.maxDrop) {
                this.addLog('扫描', `${item.symbol} 异动拦截: 滑动窗口(约${abMoveCfg.windowMinutes}min)跌幅 ${windowChange.toFixed(2)}% < -${abMoveCfg.maxDrop}%`, 'warning');
                allPassed = false;
                break;
              }
            }
          }

          if (allPassed) {
            return {
              ...item,
              status: 'Stage 0P Pass',
              reason: '波动率达标',
              details: volatilityInfo
            };
          }
          return null;
        } catch (error) {
          return null;
        }
      }));

      filteredData.push(...results.filter(r => r !== null));
      
      // 进度更新
      if (i % 50 === 0 && i > 0) {
        this.addLog('扫描', `已检查 ${i}/${symbols.length} 个币种...`);
      }
      
      // 每批之间微小延迟
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const duration = Date.now() - startTime;
    this.stage0PResults = {
      data: filteredData,
      scannedCount,
      startTime,
      duration
    };

    this.addLog('扫描', `Stage 0P 完成，筛选出 ${filteredData.length} 个币种，耗时 ${duration}ms`);
  }

  private async runStage1() {
    if (!this.isCurrentTimeEnabled()) {
      this.addLog('扫描', '当前处于非工作时段，跳过 Stage 1 扫描', 'info');
      return;
    }
    const startTime = Date.now();
    const startTimeStr = new Date(startTime + 8 * 3600 * 1000).toISOString().split('T')[1].replace('Z', '');
    this.addLog('扫描', `开始 Stage 1 基础过滤... [启动时间: ${startTimeStr}]`);
    const symbols = this.stage0PResults.data;
    const scannedCount = symbols.length;

    if (symbols.length === 0) {
      this.addLog('扫描', 'Stage 0P 结果为空，跳过 Stage 1');
      this.stage1Results = { data: [], scannedCount, startTime, duration: 0 };
      return;
    }

    const { minVolumeM1, priceChangeK1, whitelist, blacklist, interval } = this.settings.scanner.stage1;
    const [k1Min, k1Max] = priceChangeK1;

    const filteredData: any[] = [];
    const batchSize = 20;

    this.addLog('扫描', `正在检查 ${symbols.length} 个币种的 M1/K1 指标 (周期: ${interval})`);

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(async (item) => {
        try {
          if (blacklist.includes(item.symbol)) return null;
          if (whitelist.includes(item.symbol)) {
            return { ...item, status: 'Stage 1 Pass', reason: '白名单通过' };
          }

          // 优先使用 WebSocket 缓存数据 (仅限 15m 周期)
          let currentKlineData = null;
          if (interval === '15m' && this.hasCachedKline(item.symbol)) {
            currentKlineData = this.getCachedKline(item.symbol);
          } else {
            // 如果缓存没有或周期不匹配，降级使用 REST API
            const klines = await this.binance.getKlines(item.symbol, interval, 1);
            if (klines && klines.length > 0) {
              const k = klines[0];
              currentKlineData = {
                open: parseFloat(k[1]),
                close: parseFloat(k[4]),
                quoteVolume: parseFloat(k[7])
              };
            }
          }

          if (!currentKlineData) return null;

          const openPrice = currentKlineData.open;
          const currentPrice = currentKlineData.close;
          const quoteVolume = currentKlineData.quoteVolume; // Quote asset volume (USDT)

          // M1 下限检查 (USDT)
          if (quoteVolume < minVolumeM1) {
            return null;
          }

          // K1 涨跌幅检查 (不取绝对值)
          const k1 = ((currentPrice - openPrice) / openPrice) * 100;
          if (k1 < k1Min || k1 > k1Max) {
            return null;
          }

          return {
            ...item,
            status: 'Stage 1 Pass',
            reason: '指标达标',
            m1: quoteVolume.toFixed(2),
            k1: k1.toFixed(2) + '%'
          };
        } catch (error) {
          return null;
        }
      }));

      filteredData.push(...results.filter(r => r !== null));
      
      if (i % 100 === 0 && i > 0) {
        this.addLog('扫描', `已检查 ${i}/${symbols.length} 个币种...`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const duration = Date.now() - startTime;
    this.stage1Results = {
      data: filteredData,
      scannedCount,
      startTime,
      duration
    };

    this.addLog('扫描', `Stage 1 完成，筛选出 ${filteredData.length} 个币种，耗时 ${duration}ms`);
  }

  private async runStage2(isManual: boolean = false) {
    if (!this.isCurrentTimeEnabled() && !isManual) {
      this.addLog('扫描', '当前处于非工作时段，跳过 Stage 2 扫描', 'info');
      return;
    }
    const startTime = Date.now();
    const startTimeStr = new Date(startTime + 8 * 3600 * 1000).toISOString().split('T')[1].replace('Z', '');
    this.addLog('扫描', `开始 Stage 2 形态锁定... [启动时间: ${startTimeStr}]`);
    const symbols = this.stage1Results.data;
    const { cooldown } = this.settings.scanner.stage2;
    const now = Date.now();

    // 过滤掉处于冷却期的币种
    const filteredSymbols = symbols.filter((item: any) => {
      const lastClosed = this.closedPositionsHistory.get(item.symbol);
      if (lastClosed && cooldown > 0) {
        const cooldownMs = cooldown * 60 * 1000;
        if (now - lastClosed < cooldownMs) {
          const remainingMin = ((cooldownMs - (now - lastClosed)) / 60000).toFixed(1);
          this.addLog('扫描', `币种 ${item.symbol} 处于冷却期，跳过 Stage 2 扫描 (剩余 ${remainingMin} 分钟)`, 'info');
          return false;
        }
      }
      return true;
    });

    const scannedCount = filteredSymbols.length;

    if (filteredSymbols.length === 0) {
      this.addLog('扫描', symbols.length > 0 ? '所有候选币种均在冷却期中，跳过 Stage 2' : 'Stage 1 结果为空，跳过 Stage 2');
      this.stage2Results = { data: [], scannedCount: symbols.length, startTime, duration: 0 };
      return;
    }

    const { conditions } = this.settings.scanner.stage2;
    const needs15m = conditions.a.enabled || conditions.m.enabled || conditions.k2.enabled;
    const needs5m = conditions.k5.enabled;

    this.addLog('扫描', `正在并发检查 ${filteredSymbols.length} 个币种的形态指标...`);

    // 2. 并发检查所有币对数据
    const allResults = await Promise.all(filteredSymbols.map(async (item: any) => {
      try {
        let open15 = 0, high15 = 0, low15 = 0, current15 = 0, volume15 = 0;
        let open5 = 0, current5 = 0;

        // 优先从内存缓存获取 15m 数据 (WS 推送)
        const cached15m = this.getCachedKline(item.symbol);
        let usedCache = false;

        if (needs15m && cached15m) {
          open15 = cached15m.open;
          high15 = cached15m.high;
          low15 = cached15m.low;
          current15 = cached15m.close;
          volume15 = cached15m.quoteVolume;
          usedCache = true;
        }

        // 并发请求该币对所需的 K 线 (如果缓存未命中或需要 5m)
        const requests = [];
        if (needs15m && !usedCache) requests.push(this.binance.getKlines(item.symbol, '15m', 1));
        else requests.push(Promise.resolve(null));

        if (needs5m) requests.push(this.binance.getKlines(item.symbol, '5m', 1));
        else requests.push(Promise.resolve(null));

        const [klines15m, klines5m] = await Promise.all(requests);

        if (needs15m && !usedCache) {
          if (!klines15m || klines15m.length === 0) return null;
          const k15 = klines15m[0];
          open15 = parseFloat(k15[1]);
          high15 = parseFloat(k15[2]);
          low15 = parseFloat(k15[3]);
          current15 = parseFloat(k15[4]);
          volume15 = parseFloat(k15[7]);
        }

        if (needs5m) {
          if (!klines5m || klines5m.length === 0) return null;
          const k5 = klines5m[0];
          open5 = parseFloat(k5[1]);
          current5 = parseFloat(k5[4]);
        }

        const metrics: any = {
          a: needs15m ? ((high15 - current15) / current15) * 100 : 0,
          m: needs15m ? volume15 : 0,
          k2: needs15m ? ((current15 - open15) / open15) * 100 : 0,
          k5: needs5m ? ((current5 - open5) / open5) * 100 : 0,
          amp: (needs15m && low15 > 0) ? ((high15 - low15) / low15) * 100 : 0,
        };

        // 检查所有开启的条件
        let failReason = '';
        for (const [key, config] of Object.entries(conditions) as [string, any][]) {
          if (config.enabled) {
            if (key === 'a') {
              const aVal = metrics.a;
              const kVal = metrics.k2; // 扫描时刻的K
              const aConfig = config as any;
              if (aConfig.mode === 'fixed') {
                const [min, max] = aConfig.fixedRange;
                if (aVal < min || aVal > max) {
                  failReason = `A不满足(${aVal.toFixed(2)})`;
                  break;
                }
              } else {
                // 关联K模式: (A/K)*100
                if (kVal === 0) {
                  failReason = `A(关联K)失败: K为0`;
                  break;
                }
                const relativeVal = (aVal / kVal) * 100;
                const [min, max] = aConfig.relativeRange;
                if (relativeVal < min || relativeVal > max) {
                  failReason = `A(关联K)不满足(${relativeVal.toFixed(2)})`;
                  break;
                }
              }
            } else {
              const val = metrics[key as keyof typeof metrics];
              const [min, max] = (config as any).range;
              if (val < min || val > max) {
                failReason = `${key.toUpperCase()}不满足(${val.toFixed(2)})`;
                break; 
              }
            }
          }
        }

        const isPass = failReason === '';
        
        return {
          ...item,
          ...metrics,
          a: metrics.a.toFixed(2),
          k2: metrics.k2.toFixed(2),
          k5: metrics.k5.toFixed(2),
          amp: metrics.amp.toFixed(2),
          m: (metrics.m / 1000000).toFixed(2),
          status: isPass ? 'Stage 2 Pass' : 'Stage 2 Fail',
          reason: isPass ? '形态锁定成功' : failReason,
          isPass
        };
      } catch (error) {
        return null;
      }
    }));

    const finalResults = allResults.filter(r => r !== null);

    // 排序逻辑：先按是否通过排序，再按指定的模式 (交易额/涨幅/振幅) 降序排序
    const { preferredMode = 'volume' } = this.settings.scanner.stage2;
    
    finalResults.sort((a, b) => {
      if (a.isPass && !b.isPass) return -1;
      if (!a.isPass && b.isPass) return 1;
      
      if (preferredMode === 'k2') {
        return parseFloat(b.k2) - parseFloat(a.k2);
      } else if (preferredMode === 'amp') {
        return parseFloat(b.amp) - parseFloat(a.amp);
      } else {
        return parseFloat(b.m) - parseFloat(a.m);
      }
    });

    // 标记优选币对：满足条件且排在首位的
    const passedResults = finalResults.filter(r => r.isPass);
    if (passedResults.length > 0) {
      passedResults[0].isPreferred = true;
      passedResults[0].reason = '优选币对';

      // 标记其他通过但不是首选的币对
      const modeLabel = preferredMode === 'k2' ? 'K值' : (preferredMode === 'amp' ? '振幅' : 'M值');
      for (let i = 1; i < passedResults.length; i++) {
        passedResults[i].reason = `${modeLabel}不是最高`;
      }
    }

    // 统一记录日志 (反向遍历以确保优选币对在 UI 最上方)
    for (let i = finalResults.length - 1; i >= 0; i--) {
      const r = finalResults[i];
      const k5Msg = needs5m ? `K5=${r.k5}%, ` : '';
      const ampMsg = `振幅=${r.amp}%, `;
      const logMsg = `${r.symbol}: K=${r.k2}%, ${k5Msg}${ampMsg}A=${r.a}%, M=${r.m}M. ${r.isPass ? '通过' + (r.isPreferred ? '' : `，但${r.reason}`) : '未通过: ' + r.reason}`;
      this.addLog('扫描', logMsg, r.isPass ? 'success' : 'info');
    }

    if (passedResults.length > 0) {
      // 自动下单逻辑
      if (!isManual && this.isRunning && !this.isOrdering && this.currentPosition === null && this.pendingOrderSymbol === null) {
        const scanStartTime = startTime;
        const now = Date.now();
        const windowMs = (this.settings.order?.positiveWindow || 2) * 1000;

        if (now - scanStartTime <= windowMs) {
          await this.executeTrade(passedResults[0], scanStartTime);
        } else {
          this.addLog('下单', `错过下单窗口: 耗时 ${now - scanStartTime}ms > ${windowMs}ms`, 'warning');
        }
      }
    }

    const duration = Date.now() - startTime;
    this.stage2Results = {
      data: finalResults,
      scannedCount,
      startTime,
      duration
    };

    this.addLog('扫描', `Stage 2 完成，锁定 ${passedResults.length} 个币种，耗时 ${duration}ms`);
  }

  async executeTrade(coin: any, scanStartTime: number) {
    if (this.isOrdering || this.pendingOrderSymbol) return;
    this.isOrdering = true;
    this.pendingOrderSymbol = coin.symbol;
    this.addLog('下单', `准备开仓优选币对: ${coin.symbol}`, 'info');

    try {
      // 1. 获取最新价和账户余额
      const [ticker, account] = await Promise.all([
        this.binance.getTickerPrice(coin.symbol),
        this.binance.getAccountInfo()
      ]);

      const currentPrice = parseFloat(ticker.price);
      const balance = parseFloat(account.availableBalance);
      
      // 2. 计算下单量
      const leverage = this.settings.order.leverage;
      const positionRatio = this.settings.order.positionRatio / 100;
      const maxPosition = this.settings.order.maxPosition;
      
      let targetValue = balance * leverage * positionRatio;
      
      // 关联M逻辑
      if (this.settings.order.mLinkEnabled && this.settings.order.mLinkValue && this.settings.order.mLinkValue > 0) {
        const rawM = parseFloat(coin.m) * 1000000;
        const mLimit = rawM / this.settings.order.mLinkValue;
        if (mLimit < targetValue) {
          this.addLog('下单', `关联M触发限额: 原始仓位 ${targetValue.toFixed(2)}, M限制仓位 ${mLimit.toFixed(2)} (M=${coin.m}M, 关联M=${this.settings.order.mLinkValue})`, 'info');
          targetValue = mLimit;
        }
      }

      if (targetValue > maxPosition) targetValue = maxPosition;
      
      let quantity = targetValue / currentPrice;

      // 3. 精度对齐
      if (!this.exchangeInfo) {
        this.exchangeInfo = await this.binance.getExchangeInfo();
      }
      const symbolInfo = this.exchangeInfo.symbols.find((s: any) => s.symbol === coin.symbol);
      if (!symbolInfo) throw new Error(`找不到币种信息: ${coin.symbol}`);

      const lotSizeFilter = symbolInfo.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      const stepSize = parseFloat(lotSizeFilter.stepSize);
      const precision = Math.log10(1 / stepSize);
      const formattedQuantity = (Math.floor(quantity / stepSize) * stepSize).toFixed(precision);

      this.addLog('下单', `[最高] 正向单下单: ${coin.symbol}, 数量: ${formattedQuantity}, 价格: ${currentPrice}`, 'success');

      // 4. 下市价单
      const order = await this.binance.placeOrder({
        symbol: coin.symbol,
        side: 'BUY',
        type: 'MARKET',
        quantity: formattedQuantity
      });

      this.addLog('下单', `[最高] 正向单交易完成: ${coin.symbol}, 订单ID: ${order.orderId}`, 'success', order);

      // 记录交易日志
      this.addTradeLog({
        id: order.orderId.toString(),
        symbol: coin.symbol,
        side: 'BUY',
        leverage: leverage,
        amount: parseFloat(formattedQuantity),
        entryPrice: currentPrice,
        exitPrice: 0,
        pnl: 0,
        fee: 0,
        fundingFee: 0,
        fundingFeeCheckedCount: 0,
        profitRate: 0,
        kBestChange: 0,
        mValue: parseFloat(coin.m),
        openTime: Date.now(),
        closeTime: 0,
        status: 'OPEN'
      });

      // 5. 挂止盈止损 (内部会等待持仓建立)
      // 优化：将开仓单返回的实际成交信息传给挂单逻辑，减少轮询
      const executionData = {
        avgPrice: parseFloat(order.avgPrice || order.price || currentPrice.toString()),
        qty: parseFloat(order.cumQty || formattedQuantity)
      };
      await this.handleTPAndSL(coin.symbol, formattedQuantity, scanStartTime, symbolInfo, order.orderId.toString(), executionData);

    } catch (error: any) {
      this.addLog('下单', `开仓流程异常: ${error.message}`, 'error');
    } finally {
      this.pendingOrderSymbol = null;
      this.isOrdering = false;
      this.fetchAccountDataDebounced({ skipCleanup: false });
    }
  }

  private async handleTPAndSL(symbol: string, quantity: string, scanStartTime: number, symbolInfo: any, orderId: string, executionData?: { avgPrice: number, qty: number }) {
    // 优选k窗口期：严格使用最新的 15 分钟封盘数据
    const period = this.settings.order.kBestPeriod || '15m';
    let intervalMs = 15 * 60 * 1000;
    if (period.endsWith('m')) intervalMs = parseInt(period) * 60 * 1000;
    else if (period.endsWith('h')) intervalMs = parseInt(period) * 60 * 60 * 1000;
    else if (period.endsWith('d')) intervalMs = parseInt(period) * 24 * 60 * 60 * 1000;

    // 计算目标 K 线的结束时间和开始时间
    const targetTime = scanStartTime - 1000;
    const targetTimeAdjusted = targetTime + this.timeOffset;
    const targetStart = Math.floor(targetTimeAdjusted / intervalMs) * intervalMs;
    const targetEnd = targetStart + intervalMs;
    
    const formatTime = (ts: number) => {
      const d8 = new Date(ts + 8 * 3600 * 1000); // 转换为 UTC+8 显示
      return [
        d8.getUTCHours().toString().padStart(2, '0'),
        d8.getUTCMinutes().toString().padStart(2, '0'),
        d8.getUTCSeconds().toString().padStart(2, '0')
      ].join(':');
    };

    const targetStartStr = formatTime(targetStart);
    const targetEndStr = formatTime(targetEnd);

    try {
      // 快速获取逻辑：优先从 WebSocket 缓存获取，如果不可用则高频轮询 REST API
      let kBest = null;
      let attempts = 0;
      
      this.addLog('下单', `${symbol} 正在获取 K 优数据 (${targetStartStr})...`, 'info');

      while (attempts < 25) { // 提高频率，总等待时间约 5 秒
        // 1. 优先检查 WebSocket 缓存
        if (period === '15m' && this.hasCachedKline(symbol)) {
          const cached = this.getCachedKline(symbol);
          // 如果缓存的 K 线起始时间等于目标时间，且已经过了结束时间，可以考虑使用
          if (cached.timestamp === targetStart) {
             // 只要到了结束时刻，缓存数据通常就是最终值（即便 isFinal还没推到 true）
             if (Date.now() >= targetEnd) {
                kBest = [
                  cached.timestamp, 
                  cached.open.toString(), 
                  cached.high.toString(), 
                  cached.low.toString(), 
                  cached.close.toString(), 
                  "", "", 
                  cached.quoteVolume.toString()
                ];
                this.addLog('下单', `[高速] 从 WebSocket 缓存获取 K 优数据成功: ${symbol}`, 'success');
                break;
             }
          }
        }

        // 2. 轮询 REST API
        const klines = await this.binance.getKlines(symbol, period, 5, { endTime: targetEnd + intervalMs });
        kBest = klines.find((k: any) => parseInt(k[0]) === targetStart);
        
        // 如果找到了目标 K 线，且下一根已经出现（或者当前时间已大幅超过结束时间），则确认
        const nextK = klines.find((k: any) => parseInt(k[0]) === targetStart + intervalMs);
        if (kBest && (nextK || Date.now() > targetEnd + 1000)) break;
        
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 200)); // 缩短轮询间隔到 200ms
      }
      
      if (!kBest) {
        throw new Error(`无法获取 ${symbol} 目标区间 (${targetStartStr}) 的 K 线数据`);
      }

      const kBestOpen = parseFloat(kBest[1]);
      const kBestHigh = parseFloat(kBest[2]);
      const kBestClose = parseFloat(kBest[4]);
      const kBestQuoteVolume = parseFloat(kBest[7]); // 交易额
      
      // 增加 K 优开/收原始数据日志
      this.addLog('下单', `[最高] 获取k优开成功: ${symbol}, 开盘价 ${kBestOpen}, 最高价 ${kBestHigh}, 当前/收盘价 ${kBestClose}, 交易额 ${kBestQuoteVolume.toFixed(2)}`, 'success');

      const entryPrice = executionData?.avgPrice || (this.currentPosition ? this.currentPosition.entryPrice : kBestClose);
      // 使用绝对值计算涨跌幅
      const kBestChange = Math.abs((kBestClose - kBestOpen) / kBestOpen);
      
      // 真实A = (最高值 - k优收) / k优收 * 100
      const realA = ((kBestHigh - kBestClose) / kBestClose) * 100;

      // 更新交易日志中的 K 优涨跌幅、M值（交易额，单位：100万）和真实A
      this.updateTradeLog(orderId, { 
        kBestChange, 
        mValue: parseFloat((kBestQuoteVolume / 1000000).toFixed(2)),
        realA 
      });

      // 止盈价计算
      let theoreticalTP: number;
      if (this.settings.order.tpMode === 'fixed') {
        theoreticalTP = kBestClose * (1 + this.settings.order.tpFixed / 100);
      } else {
        const tpRatio = this.settings.order.tpRatio / 100;
        theoreticalTP = kBestClose * (1 + kBestChange * tpRatio);
      }

      // 止损价计算
      let theoreticalSL: number;
      if (this.settings.order.slMode === 'fixed') {
        theoreticalSL = kBestClose * (1 - this.settings.order.slFixed / 100);
      } else {
        const slRatio = this.settings.order.slRatio / 100;
        theoreticalSL = kBestClose * (1 - kBestChange * slRatio);
      }

      // 安全垫：止盈价必须高于入场价，止损价必须低于入场价，防止滑点导致立即成交
      const safeTP = Math.max(theoreticalTP, entryPrice * 1.0001);
      const safeSL = Math.min(theoreticalSL, entryPrice * 0.9999);

      // 价格精度对齐 (优化版)
      const priceFilter = symbolInfo.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
      const tickSize = parseFloat(priceFilter.tickSize);
      const pricePrecision = Math.max(0, Math.round(-Math.log10(tickSize)));
      
      // 使用极小偏移量 (epsilon) 修正 JS 浮点计算误差，确保对齐准确
      const epsilon = tickSize / 1000;
      
      // 止盈向下取整 (floor)：确保更容易成交
      const formattedTP = (Math.floor((safeTP + epsilon) / tickSize) * tickSize).toFixed(pricePrecision);
      // 止损向上取整 (ceil)：确保更安全止损
      const formattedSL = (Math.ceil((safeSL - epsilon) / tickSize) * tickSize).toFixed(pricePrecision);

      this.addLog('下单', `[最高] 获取k优开计算完成: ${symbol} [${targetStartStr} - ${targetEndStr}] - 入场价: ${entryPrice}, K优开: ${kBestOpen}, K优收: ${kBestClose}, TP: ${formattedTP}, SL: ${formattedSL} (K优波动率: ${(kBestChange * 100).toFixed(2)}%)`, 'success');

      // 确保正向单已成交并建立持仓
      let posEstablished = false;
      let posAttempts = 0;
      
      // 优化：如果有 executionData (已经知道成交了)，则优先使用
      if (executionData && executionData.qty > 0) {
        posEstablished = true;
        this.addLog('下单', `[高速探测] 使用开仓返回的成交数据: ${symbol}, 数量: ${executionData.qty}`, 'success');
      }

      while (!posEstablished && posAttempts < 20) { // 降低尝试次数，拉长间隔
        // 强制刷新账户数据
        await this.fetchAccountData();
        
        if (this.currentPosition && this.currentPosition.symbol === symbol && Math.abs(this.currentPosition.amount) > 0) {
          posEstablished = true;
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000)); // 拉长轮询间隔到 1000ms
        posAttempts++;
      }

      if (!posEstablished) {
        this.addLog('下单', `未检测到 ${symbol} 持仓，取消挂止盈止损`, 'warning');
        return;
      }

      // 使用实际持仓数量
      const lotSizeFilter = symbolInfo.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      const stepSize = parseFloat(lotSizeFilter.stepSize);
      const qtyPrecision = Math.max(0, Math.round(-Math.log10(stepSize)));
      const actualQuantity = Math.abs(this.currentPosition.amount).toFixed(qtyPrecision);

      this.addLog('下单', `检测到持仓: ${symbol}, 数量: ${actualQuantity}, 准备挂单...`, 'info');

      // 检查是否已经存在挂单，避免重复挂单风险
      const existingOrders = this.accountData.openOrders.filter((o: any) => o.symbol === symbol);
      const hasLimit = existingOrders.some((o: any) => !o.isAlgo);
      const hasAlgo = existingOrders.some((o: any) => o.isAlgo);

      // 挂止盈单 (Limit Sell)
      if (!hasLimit && this.settings.order.tpEnabled !== false) {
        const tpOrder = await this.binance.placeOrder({
          symbol,
          side: 'SELL',
          type: 'LIMIT',
          quantity: actualQuantity,
          price: formattedTP,
          timeInForce: 'GTC',
          reduceOnly: 'true'
        });
        this.addLog('下单', `[最高] limit挂单完成: ${symbol}, 价格: ${formattedTP}, 订单ID: ${tpOrder.orderId}`, 'success', tpOrder);
      } else if (this.settings.order.tpEnabled === false) {
        this.addLog('下单', `${symbol} 已关闭止盈挂单功能`, 'info');
      } else {
        this.addLog('下单', `${symbol} 已存在 Limit 挂单，跳过重复挂单`, 'info');
      }

      // 只有在 limit 挂单成功后，再下 algo 委托单
      // 挂止损单 (Algo Stop Market)
      if (!hasAlgo && this.settings.order.slEnabled !== false) {
        const slOrder = await this.binance.createAlgoOrder({
          symbol,
          side: 'SELL',
          algoType: 'CONDITIONAL',
          type: 'STOP_MARKET',
          quantity: actualQuantity,
          stopPrice: formattedSL,
          triggerPrice: formattedSL,
          reduceOnly: 'true'
        });
        this.addLog('下单', `[最高] algo挂单完成: ${symbol}, 触发价: ${formattedSL}, 订单ID: ${slOrder.algoId || slOrder.orderId}`, 'success', slOrder);
      } else if (this.settings.order.slEnabled === false) {
        this.addLog('下单', `${symbol} 已关闭止损挂单功能`, 'info');
      } else {
        this.addLog('下单', `${symbol} 已存在 Algo 挂单，跳过重复挂单`, 'info');
      }

    } catch (error: any) {
      this.addLog('下单', `设置止盈止损失败: ${error.message}`, 'error');
      // 处理 -2021 错误：Order would immediately trigger
      if (error.message.includes('-2021') || error.message.includes('Order would immediately trigger')) {
        this.addLog('下单', `检测到触发价已被穿过 (${symbol})，执行紧急市价平仓...`, 'warning');
        await this.closeCurrentPosition();
      }
    }
  }
  
  getScanResults(stage: number) {
    switch (stage) {
      case 0: return this.stage0Results;
      case 1: return this.stage0PResults;
      case 2: return this.stage1Results;
      case 3: return this.stage2Results;
      default: return null;
    }
  }

  getAllScanResults() {
    return {
      0: this.stage0Results,
      1: this.stage0PResults,
      2: this.stage1Results,
      3: this.stage2Results
    };
  }

  getSettings() {
    return this.settings;
  }

  async updateSettings(settings: any) {
    const oldBinance = this.settings.binance;
    this.settings = settings;
    this.binance = new BinanceService(settings.binance);
    
    // Save to database
    await dbService.saveSettings(settings, `settings_${this.accountId}`).catch(err => {
      console.error(`Failed to save settings to database for [${this.accountId}]:`, err);
    });

    if (this.onUpdate) {
      this.onUpdate('settings', this.settings);
    }

    this.addLog('系统', '设置已更新并同步至数据库', 'info');

    // 如果引擎正在运行，重新初始化连接以确保配置生效
    if (this.isRunning) {
      this.addLog('系统', '正在重新初始化连接以应用新设置...', 'info');
      // 不使用 await，避免阻塞调用者（如 API 响应）
      this.initWebSocket().catch(e => {
        this.addLog('WebSocket', `更新设置后重连失败: ${e.message}`, 'error');
      });
      this.fetchAccountData().catch(() => {});
      this.checkApiStatus().catch(() => {});
    }
  }

  async searchTradeLogsLocally(symbol?: string, startTime?: number, endTime?: number) {
    this.addLog('系统', `正在从本地数据库搜索交易日志... ${symbol && symbol !== 'ALL' ? '币种: ' + symbol : ''}`, 'info');
    
    try {
      const searchSymbol = symbol === 'ALL' ? undefined : symbol;
      const logs = await dbService.getTradeLogs(this.accountId, searchSymbol, startTime, endTime);
      
      // 更新内存中的日志（合并新发现的日志）
      let addedCount = 0;
      logs.forEach(log => {
        if (!this.tradeLogs.find(t => t.id === log.id)) {
          this.tradeLogs.push(log);
          addedCount++;
        }
      });

      if (addedCount > 0) {
        // 重新排序
        this.tradeLogs.sort((a, b) => b.openTime - a.openTime);
        if (this.onUpdate) {
          this.onUpdate('tradeLogs', this.tradeLogs);
        }
      }

      this.addLog('系统', `本地搜索完成，共找到 ${logs.length} 条记录${addedCount > 0 ? `，其中 ${addedCount} 条已同步到当前视图` : ''}`, 'success');
      return logs;
    } catch (error: any) {
      this.addLog('系统', `本地搜索失败: ${error.message}`, 'error');
      return [];
    }
  }

  getLogs() {
    return this.logs;
  }

  getTradeLogs() {
    return this.tradeLogs;
  }

  getTransferLogs() {
    return this.transferLogs;
  }

  async transferToSpot(amount: string) {
    try {
      const result = await this.binance.transferToSpot(amount);
      this.addLog('划转', `成功划转 ${amount} USDT 到现货账户`, 'success');
      
      // Record in transfer logs
      const log: TransferLog = {
        id: Math.random().toString(36).substr(2, 9),
        asset: 'USDT',
        amount: parseFloat(amount),
        type: 'OUT',
        status: 'SUCCESS',
        timestamp: Date.now(),
        message: '手动划转: 合约 -> 现货'
      };
      this.transferLogs.unshift(log);
      if (this.transferLogs.length > 1000) this.transferLogs.pop();
      dbService.saveTransferLog(log).catch(err => console.error('Failed to save transfer log:', err));
      if (this.onUpdate) this.onUpdate('transferLogs', this.transferLogs);

      this.fetchAccountData();
      return result;
    } catch (error: any) {
      this.addLog('划转', `划转失败: ${error.message}`, 'error');
      
      // Record failed attempt
      const log: TransferLog = {
        id: Math.random().toString(36).substr(2, 9),
        asset: 'USDT',
        amount: parseFloat(amount),
        type: 'OUT',
        status: 'FAILED',
        timestamp: Date.now(),
        message: `手动划转失败: ${error.message}`
      };
      this.transferLogs.unshift(log);
      dbService.saveTransferLog(log).catch(err => console.error('Failed to save transfer log:', err));
      if (this.onUpdate) this.onUpdate('transferLogs', this.transferLogs);
      
      throw error;
    }
  }

  async transferToFutures(amount: string) {
    try {
      const result = await this.binance.transferToFutures(amount);
      this.addLog('划转', `成功划转 ${amount} USDT 到合约账户`, 'success');
      
      // Record in transfer logs
      const log: TransferLog = {
        id: Math.random().toString(36).substr(2, 9),
        asset: 'USDT',
        amount: parseFloat(amount),
        type: 'IN',
        status: 'SUCCESS',
        timestamp: Date.now(),
        message: '手动划转: 现货 -> 合约'
      };
      this.transferLogs.unshift(log);
      if (this.transferLogs.length > 1000) this.transferLogs.pop();
      dbService.saveTransferLog(log).catch(err => console.error('Failed to save transfer log:', err));
      if (this.onUpdate) this.onUpdate('transferLogs', this.transferLogs);

      this.fetchAccountData();
      return result;
    } catch (error: any) {
      this.addLog('划转', `划转失败: ${error.message}`, 'error');

      // Record failed attempt
      const log: TransferLog = {
        id: Math.random().toString(36).substr(2, 9),
        asset: 'USDT',
        amount: parseFloat(amount),
        type: 'IN',
        status: 'FAILED',
        timestamp: Date.now(),
        message: `手动划转失败: ${error.message}`
      };
      this.transferLogs.unshift(log);
      dbService.saveTransferLog(log).catch(err => console.error('Failed to save transfer log:', err));
      if (this.onUpdate) this.onUpdate('transferLogs', this.transferLogs);

      throw error;
    }
  }

  async clearTradeLogs() {
    this.tradeLogs = [];
    await dbService.clearAllLogs().catch(err => {
      console.error('Failed to clear logs from database:', err);
    });
    this.addLog('系统', '交易日志已清空', 'info');
    if (this.onUpdate) {
      this.onUpdate('tradeLogs', this.tradeLogs);
    }
  }

  async clearTransferLogs() {
    this.transferLogs = [];
    await dbService.clearAllTransferLogs().catch(err => {
      console.error('Failed to clear transfer logs from database:', err);
    });
    this.addLog('系统', '资金划转日志已清空', 'info');
    if (this.onUpdate) {
      this.onUpdate('transferLogs', this.transferLogs);
    }
  }

  clearLogs() {
    this.logs = [];
    this.addLog('系统', '日志已清空', 'info');
    if (this.onUpdate) {
      this.onUpdate('logs', this.logs);
    }
  }

  private async checkAndRecordBalance() {
    const now = new Date();
    const minutes = now.getMinutes();
    const hour = now.getHours();

    if (minutes === 18 && this.lastBalanceRecordHour !== hour) {
      const totalBalance = parseFloat(this.accountData.totalBalance);
      if (isNaN(totalBalance) || totalBalance === 0) return;

      this.lastBalanceRecordHour = hour;
      const log: BalanceLog = {
        id: Math.random().toString(36).substr(2, 9),
        totalBalance,
        timestamp: Date.now()
      };

      this.balanceLogs.push(log);
      if (this.balanceLogs.length > 5000) this.balanceLogs.shift();

      this.addLog('系统', `每小时 18 分余额记录: ${totalBalance.toFixed(2)} USDT`, 'info');

      // Persist to database
      dbService.saveBalanceLog(log, this.accountId).catch(err => {
        console.error(`[${this.accountId}] Failed to save balance log to database:`, err);
      });

      if (this.onUpdate) {
        this.onUpdate('balanceLogs', this.balanceLogs);
      }
    }
  }

  getStage0Results() {
    return this.stage0Results;
  }

  getStage0PResults() {
    return this.stage0PResults;
  }

  getBalanceLogs() {
    return this.balanceLogs;
  }

  async searchBalanceLogs(startTime: number, endTime: number, onlySnapshot: boolean = false) {
    return dbService.getBalanceLogsFiltered(this.accountId, startTime, endTime, onlySnapshot);
  }

  clearBalanceLogs() {
    this.balanceLogs = [];
    dbService.clearAllBalanceLogs().catch(err => {
      console.error('Failed to clear balance logs in database:', err);
    });
    if (this.onUpdate) {
      this.onUpdate('balanceLogs', this.balanceLogs);
    }
  }

  getSystemStatus() {
    const status = {
      isRunning: this.isRunning,
      apiConnected: this.apiConnected,
      wsConnected: this.wsConnected,
      lastScanTime: this.lastScanTime,
      currentPosition: this.currentPosition,
      lastUpdate: Date.now(),
    };
    
    if (this.onUpdate) {
      this.onUpdate('status', status);
    }
    
    return status;
  }

  getAccountData() {
    return this.accountData;
  }
}
