export interface BinanceSettings {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
  wsUrl: string;
}

export interface ScannerSettings {
  stage0: {
    interval: string;
    startTime: string;
    klinePeriod: string;
    minKlines: number;
    maxKlines: number;
    includeTradFi: boolean;
  };
  stage0P: {
    enabled: boolean;
    interval: string;
    startTime: string;
    periods: {
      [key: string]: {
        enabled: boolean;
        count: number;
        threshold: number;
      };
    };
    abnormalMove?: {
      enabled: boolean;
      lookbackHours: number;    // 考察时长 (如 10)
      windowMinutes: number;    // 统计区间 (如 60)
      maxPump: number;         // 最大涨幅 (%)
      maxDrop: number;         // 最大跌幅 (%)
    };
  };
  stage1: {
    interval: string;
    startTime: string;
    minVolumeM1: number;
    priceChangeK1: [number, number];
    whitelist: string[];
    blacklist: string[];
  };
  stage2: {
    interval: string;
    startTime: string;
    cooldown: number;
    preferredMode?: 'volume' | 'k2' | 'amp'; // 新增：优选模式 (volume: 交易额, k2: 涨幅, amp: 振幅)
    conditions: {
      k2: { enabled: boolean; range: [number, number] };
      a: { 
        enabled: boolean; 
        mode: 'fixed' | 'relative'; 
        fixedRange: [number, number];
        relativeRange: [number, number];
      };
      m: { enabled: boolean; range: [number, number] };
      k5: { enabled: boolean; range: [number, number] };
    };
  };
  timeControl: {
    enabled: boolean;
    hours: boolean[];
    mode: '+2' | '-2';
  };
}

export interface OrderSettings {
  leverage: number;
  positionRatio: number;
  maxPosition: number;
  tpMode: 'ratio' | 'fixed';
  tpRatio: number;
  tpFixed: number;
  tpEnabled?: boolean; // 新增：是否开启止盈挂单
  slMode: 'ratio' | 'fixed';
  slRatio: number;
  slFixed: number;
  slEnabled?: boolean; // 新增：是否开启止损挂单
  mLinkEnabled?: boolean; // 新增：关联M生效
  mLinkValue?: number; // 新增：关联M值
  positiveWindow: number;
  maxHoldTime: number;
  kBestPeriod: string;
  kBestWindow: [number, number];
}

export interface EmailSettings {
  enabled: boolean;
  sender: string;
  receiver: string;
  smtpServer: string;
  smtpPort: number;
  password: string;
  minBalance: number;
  maxConsecutiveLoss: number;
}

export interface WithdrawalSettings {
  withdrawalThreshold: number;
  retentionThreshold: number;
  alarmThreshold: number;
}

export interface AccountConfig {
  id: string;
  name: string;
  enabled: boolean;
  binance: BinanceSettings;
  scanner: ScannerSettings;
  order: OrderSettings;
  withdrawal: WithdrawalSettings;
}

export interface AppSettings {
  appName?: string;
  accounts: AccountConfig[];
  email: EmailSettings;
  auth: {
    username: string;
    password: string;
  };
}

export interface TradeLog {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  leverage: number;
  amount: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  fee: number;
  fundingFee: number;
  fundingFeeCheckedCount?: number; // 新增：记录资金费查询次数
  profitRate: number;
  kBestChange?: number; // 新增：K优涨跌幅
  mValue?: number; // 新增：M值
  realA?: number; // 新增：真实A
  openTime: number;
  closeTime: number;
  status: 'OPEN' | 'CLOSED';
}

export interface LogEntry {
  id: string;
  timestamp: number;
  type: 'info' | 'success' | 'warning' | 'error';
  module: string;
  message: string;
  details?: any;
}

export interface Position {
  symbol: string;
  amount: number;
  entryPrice: number;
  side: 'BUY' | 'SELL';
  timestamp: number;
}

export interface Order {
  symbol: string;
  orderId: number;
  type: string;
  side: string;
  price: string;
  stopPrice?: string;
  timestamp: number;
}

export interface TransferLog {
  id: string;
  asset: string;
  amount: number;
  type: 'IN' | 'OUT'; // IN: Spot to Futures, OUT: Futures to Spot
  status: 'SUCCESS' | 'FAILED';
  timestamp: number;
  message?: string;
}

export interface BalanceLog {
  id: string;
  totalBalance: number;
  timestamp: number;
}

export interface Kline {
  symbol: string;
  interval: string;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteAssetVolume: number;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: number;
  takerBuyQuoteAssetVolume: number;
  change?: number; // 新增：涨跌幅
  amplitude?: number; // 新增：振幅
}
