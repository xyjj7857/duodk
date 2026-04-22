import Database from 'better-sqlite3';
import { TradeLog, TransferLog, BalanceLog } from '../types';
import path from 'path';
import fs from 'fs';

export class DatabaseService {
  private db: any = null;
  private dbPath: string;

  constructor() {
    this.dbPath = path.join(process.cwd(), 'data', 'trades.db');
    // Ensure data directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async init() {
    if (this.db) return;
    try {
      console.log('Initializing database at:', this.dbPath);
      this.db = new Database(this.dbPath);
      
      // Set pragmas for performance
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS trade_logs (
          id TEXT PRIMARY KEY,
          accountId TEXT DEFAULT 'default',
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          leverage REAL NOT NULL,
          amount REAL NOT NULL,
          entryPrice REAL NOT NULL,
          exitPrice REAL NOT NULL,
          pnl REAL NOT NULL,
          fee REAL NOT NULL,
          fundingFee REAL NOT NULL,
          fundingFeeCheckedCount INTEGER DEFAULT 0,
          profitRate REAL NOT NULL,
          kBestChange REAL,
          mValue REAL,
          realA REAL,
          openTime INTEGER NOT NULL,
          closeTime INTEGER NOT NULL,
          status TEXT NOT NULL
        )
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS transfer_logs (
          id TEXT PRIMARY KEY,
          accountId TEXT DEFAULT 'default',
          asset TEXT NOT NULL,
          amount REAL NOT NULL,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          message TEXT
        )
      `);
      
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS balance_logs (
          id TEXT PRIMARY KEY,
          accountId TEXT DEFAULT 'default',
          totalBalance REAL NOT NULL,
          timestamp INTEGER NOT NULL
        )
      `);
      
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          updatedAt INTEGER NOT NULL
        )
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS klines (
          symbol TEXT NOT NULL,
          interval TEXT NOT NULL,
          openTime INTEGER NOT NULL,
          open REAL NOT NULL,
          high REAL NOT NULL,
          low REAL NOT NULL,
          close REAL NOT NULL,
          volume REAL NOT NULL,
          closeTime INTEGER NOT NULL,
          quoteAssetVolume REAL,
          numberOfTrades INTEGER,
          takerBuyBaseAssetVolume REAL,
          takerBuyQuoteAssetVolume REAL,
          change REAL DEFAULT 0,
          amplitude REAL DEFAULT 0,
          PRIMARY KEY (symbol, interval, openTime)
        )
      `);

      // Create index for faster searching
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_logs_accountId ON trade_logs(accountId)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_logs_symbol ON trade_logs(symbol)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_logs_openTime ON trade_logs(openTime)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_transfer_logs_accountId ON transfer_logs(accountId)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_transfer_logs_timestamp ON transfer_logs(timestamp)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_balance_logs_accountId ON balance_logs(accountId)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_balance_logs_timestamp ON balance_logs(timestamp)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_klines_symbol_interval_time ON klines(symbol, interval, openTime)`);

      // Migration: Add columns to existing tables
      const tradeLogsInfo = this.db.prepare("PRAGMA table_info(trade_logs)").all();
      const tradeLogColumns = tradeLogsInfo.map((col: any) => col.name);
      
      if (!tradeLogColumns.includes('accountId')) {
        console.log('Migrating database: Adding accountId column to trade_logs');
        this.db.exec(`ALTER TABLE trade_logs ADD COLUMN accountId TEXT DEFAULT 'default'`);
      }
      if (!tradeLogColumns.includes('kBestChange')) {
        console.log('Migrating database: Adding kBestChange column');
        this.db.exec(`ALTER TABLE trade_logs ADD COLUMN kBestChange REAL DEFAULT 0`);
      }
      if (!tradeLogColumns.includes('mValue')) {
        console.log('Migrating database: Adding mValue column');
        this.db.exec(`ALTER TABLE trade_logs ADD COLUMN mValue REAL DEFAULT 0`);
      }
      if (!tradeLogColumns.includes('realA')) {
        console.log('Migrating database: Adding realA column');
        this.db.exec(`ALTER TABLE trade_logs ADD COLUMN realA REAL DEFAULT 0`);
      }

      const transferLogsInfo = this.db.prepare("PRAGMA table_info(transfer_logs)").all();
      const transferLogColumns = transferLogsInfo.map((col: any) => col.name);
      if (!transferLogColumns.includes('accountId')) {
        console.log('Migrating database: Adding accountId column to transfer_logs');
        this.db.exec(`ALTER TABLE transfer_logs ADD COLUMN accountId TEXT DEFAULT 'default'`);
      }

      const balanceLogsInfo = this.db.prepare("PRAGMA table_info(balance_logs)").all();
      const balanceLogColumns = balanceLogsInfo.map((col: any) => col.name);
      if (!balanceLogColumns.includes('accountId')) {
        console.log('Migrating database: Adding accountId column to balance_logs');
        this.db.exec(`ALTER TABLE balance_logs ADD COLUMN accountId TEXT DEFAULT 'default'`);
      }

      const klinesInfo = this.db.prepare("PRAGMA table_info(klines)").all();
      const klineColumns = klinesInfo.map((col: any) => col.name);
      if (!klineColumns.includes('change')) {
        console.log('Migrating database: Adding change column to klines');
        this.db.exec(`ALTER TABLE klines ADD COLUMN change REAL DEFAULT 0`);
      }
      if (!klineColumns.includes('amplitude')) {
        console.log('Migrating database: Adding amplitude column to klines');
        this.db.exec(`ALTER TABLE klines ADD COLUMN amplitude REAL DEFAULT 0`);
      }

      console.log('Database initialized successfully with better-sqlite3.');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      this.db = null;
    }
  }

  async saveTradeLog(log: TradeLog, accountId: string = 'default') {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO trade_logs (
          id, accountId, symbol, side, leverage, amount, entryPrice, exitPrice, pnl, fee, fundingFee, fundingFeeCheckedCount, profitRate, kBestChange, mValue, realA, openTime, closeTime, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        log.id, accountId, log.symbol, log.side, log.leverage, log.amount, log.entryPrice, 
        log.exitPrice, log.pnl, log.fee, log.fundingFee, log.fundingFeeCheckedCount || 0, log.profitRate, 
        log.kBestChange || 0, log.mValue || 0, log.realA || 0,
        log.openTime, log.closeTime, log.status
      );
    } catch (error) {
      console.error('Failed to save trade log:', error);
    }
  }

  async getTradeLogs(accountId: string = 'default', symbol?: string, startTime?: number, endTime?: number): Promise<TradeLog[]> {
    if (!this.db) return [];
    try {
      let query = `SELECT * FROM trade_logs WHERE accountId = ?`;
      const params: any[] = [accountId];

      if (symbol) {
        query += ` AND symbol = ?`;
        params.push(symbol);
      }
      if (startTime) {
        query += ` AND closeTime >= ?`;
        params.push(startTime);
      }
      if (endTime) {
        query += ` AND closeTime <= ?`;
        params.push(endTime);
      }

      query += ` ORDER BY openTime DESC`;
      return this.db.prepare(query).all(...params) as TradeLog[];
    } catch (error) {
      console.error('Failed to search trade logs:', error);
      return [];
    }
  }

  async getAllTradeLogs(accountId: string = 'default'): Promise<TradeLog[]> {
    if (!this.db) return [];
    try {
      return this.db.prepare(`SELECT * FROM trade_logs WHERE accountId = ? ORDER BY openTime DESC`).all(accountId) as TradeLog[];
    } catch (error) {
      console.error('Failed to get all trade logs:', error);
      return [];
    }
  }

  async clearAllLogs(accountId: string = 'default') {
    if (!this.db) return;
    try {
      this.db.prepare(`DELETE FROM trade_logs WHERE accountId = ?`).run(accountId);
    } catch (error) {
      console.error('Failed to clear all logs:', error);
    }
  }

  async saveTransferLog(log: TransferLog, accountId: string = 'default') {
    if (!this.db) return;
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO transfer_logs (
          id, accountId, asset, amount, type, status, timestamp, message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(log.id, accountId, log.asset, log.amount, log.type, log.status, log.timestamp, log.message || '');
    } catch (error) {
      console.error('Failed to save transfer log:', error);
    }
  }

  async getAllTransferLogs(accountId: string = 'default'): Promise<TransferLog[]> {
    if (!this.db) return [];
    try {
      return this.db.prepare(`SELECT * FROM transfer_logs WHERE accountId = ? ORDER BY timestamp DESC`).all(accountId) as TransferLog[];
    } catch (error) {
      console.error('Failed to get all transfer logs:', error);
      return [];
    }
  }

  async clearAllTransferLogs(accountId: string = 'default') {
    if (!this.db) return;
    try {
      this.db.prepare(`DELETE FROM transfer_logs WHERE accountId = ?`).run(accountId);
    } catch (error) {
      console.error('Failed to clear all transfer logs:', error);
    }
  }

  async saveBalanceLog(log: BalanceLog, accountId: string = 'default') {
    if (!this.db) return;
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO balance_logs (
          id, accountId, totalBalance, timestamp
        ) VALUES (?, ?, ?, ?)
      `);
      stmt.run(log.id, accountId, log.totalBalance, log.timestamp);
    } catch (error) {
      console.error('Failed to save balance log:', error);
    }
  }

  async getBalanceLogs(accountId: string = 'default', limit: number = 1000): Promise<BalanceLog[]> {
    if (!this.db) return [];
    try {
      return this.db.prepare(`SELECT * FROM balance_logs WHERE accountId = ? ORDER BY timestamp ASC LIMIT ?`).all(accountId, limit) as BalanceLog[];
    } catch (error) {
      console.error('Failed to get balance logs:', error);
      return [];
    }
  }

  async getBalanceLogsFiltered(accountId: string = 'default', startTime: number, endTime: number, onlySnapshot: boolean = false): Promise<BalanceLog[]> {
    if (!this.db) return [];
    try {
      let query = `SELECT * FROM balance_logs WHERE accountId = ? AND timestamp >= ? AND timestamp <= ?`;
      const params: any[] = [accountId, startTime, endTime];

      if (onlySnapshot) {
        query += ` AND strftime('%H:%M', datetime(timestamp/1000, 'unixepoch', 'localtime')) = '00:18'`;
      }

      query += ` ORDER BY timestamp ASC`;
      return this.db.prepare(query).all(...params) as BalanceLog[];
    } catch (error) {
      console.error('Failed to get filtered balance logs:', error);
      return [];
    }
  }

  async clearAllBalanceLogs(accountId: string = 'default') {
    if (!this.db) return;
    try {
      this.db.prepare(`DELETE FROM balance_logs WHERE accountId = ?`).run(accountId);
    } catch (error) {
      console.error('Failed to clear all balance logs:', error);
    }
  }

  async saveSettings(settings: any, settingsId: string = 'current_settings') {
    if (!this.db) return;
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO settings (id, data, updatedAt)
        VALUES (?, ?, ?)
      `);
      stmt.run(settingsId, JSON.stringify(settings), Date.now());
    } catch (error) {
      console.error('Failed to save settings to database:', error);
    }
  }

  async getSettings(settingsId: string = 'current_settings'): Promise<any | null> {
    if (!this.db) return null;
    try {
      const row = this.db.prepare(`SELECT data FROM settings WHERE id = ?`).get(settingsId);
      if (row && row.data) {
        return JSON.parse(row.data);
      }
      return null;
    } catch (error) {
      console.error('Failed to get settings from database:', error);
      return null;
    }
  }

  async deleteSettings(settingsId: string) {
    if (!this.db) return;
    try {
      this.db.prepare(`DELETE FROM settings WHERE id = ?`).run(settingsId);
    } catch (error) {
      console.error('Failed to delete settings from database:', error);
    }
  }

  async clearAccountData(accountId: string) {
    if (!this.db) return;
    try {
      const transaction = this.db.transaction(() => {
        this.db.prepare(`DELETE FROM trade_logs WHERE accountId = ?`).run(accountId);
        this.db.prepare(`DELETE FROM transfer_logs WHERE accountId = ?`).run(accountId);
        this.db.prepare(`DELETE FROM balance_logs WHERE accountId = ?`).run(accountId);
        this.db.prepare(`DELETE FROM settings WHERE id = ?`).run(`settings_${accountId}`);
      });
      transaction();
    } catch (error) {
      console.error(`Failed to clear all data for account ${accountId}:`, error);
    }
  }
  
  async getAllSettingsIds(): Promise<string[]> {
    if (!this.db) return [];
    try {
      const rows = this.db.prepare(`SELECT id FROM settings`).all();
      return rows.map((r: any) => r.id);
    } catch (error) {
      console.error('Failed to get all settings IDs:', error);
      return [];
    }
  }

  async saveKline(kline: any) {
    if (!this.db) return;
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO klines (
          symbol, interval, openTime, open, high, low, close, volume, closeTime, 
          quoteAssetVolume, numberOfTrades, takerBuyBaseAssetVolume, takerBuyQuoteAssetVolume,
          change, amplitude
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        kline.symbol, kline.interval, kline.openTime, kline.open, kline.high, kline.low, kline.close, 
        kline.volume, kline.closeTime, kline.quoteAssetVolume, kline.numberOfTrades, 
        kline.takerBuyBaseAssetVolume, kline.takerBuyQuoteAssetVolume,
        kline.change || 0, kline.amplitude || 0
      );
    } catch (error) {
      console.error('Failed to save kline:', error);
    }
  }

  async saveKlines(klines: any[]) {
    if (!this.db || klines.length === 0) return;
    try {
      const insert = this.db.prepare(`
        INSERT OR REPLACE INTO klines (
          symbol, interval, openTime, open, high, low, close, volume, closeTime, 
          quoteAssetVolume, numberOfTrades, takerBuyBaseAssetVolume, takerBuyQuoteAssetVolume,
          change, amplitude
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const transaction = this.db.transaction((items: any[]) => {
        for (const kline of items) {
          insert.run(
            kline.symbol, kline.interval, kline.openTime, kline.open, kline.high, kline.low, kline.close, 
            kline.volume, kline.closeTime, kline.quoteAssetVolume, kline.numberOfTrades, 
            kline.takerBuyBaseAssetVolume, kline.takerBuyQuoteAssetVolume,
            kline.change || 0, kline.amplitude || 0
          );
        }
      });
      transaction(klines);
    } catch (error) {
      console.error('Failed to save klines batch:', error);
    }
  }

  async getLatestKlineTime(symbol: string, interval: string): Promise<number> {
    if (!this.db) return 0;
    try {
      const row = this.db.prepare(`
        SELECT MAX(openTime) as maxTime FROM klines WHERE symbol = ? AND interval = ?
      `).get(symbol, interval);
      return row?.maxTime || 0;
    } catch (error) {
      console.error('Failed to get latest kline time:', error);
      return 0;
    }
  }

  async getKlines(symbol: string, interval: string, limit: number = 300): Promise<any[]> {
    if (!this.db) return [];
    try {
      return this.db.prepare(`
        SELECT * FROM klines WHERE symbol = ? AND interval = ? ORDER BY openTime DESC LIMIT ?
      `).all(symbol, interval, limit);
    } catch (error) {
      console.error('Failed to get klines:', error);
      return [];
    }
  }

  async pruneKlines(symbol: string, interval: string, keepLimit: number = 300) {
    if (!this.db) return;
    try {
      // Find the cutoff time
      const row = this.db.prepare(`
        SELECT openTime FROM klines 
        WHERE symbol = ? AND interval = ? 
        ORDER BY openTime DESC 
        LIMIT 1 OFFSET ?
      `).get(symbol, interval, keepLimit - 1);

      if (row) {
        this.db.prepare(`
          DELETE FROM klines 
          WHERE symbol = ? AND interval = ? AND openTime < ?
        `).run(symbol, interval, row.openTime);
      }
    } catch (error) {
      console.error('Failed to prune klines:', error);
    }
  }
}

export const dbService = new DatabaseService();
