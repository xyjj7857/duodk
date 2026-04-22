import { AppSettings } from "./types";

export const APP_NAME = "超强49";

export const DEFAULT_SETTINGS: AppSettings = {
  appName: APP_NAME,
  accounts: [
    {
      id: "default",
      name: "账户1",
      enabled: true,
      binance: {
        apiKey: "oDQleHC2fKUyLORiNvYxDhbjMwd0tSJerZ16UpDeodVpftUt5rajHDac8f0qhPZX",
        secretKey: "APwIfMbrtqw3oo0Xi3xmm4JgyXepOI1m0GVAurggIyw0VWJ1hWU0QpXJ3e7Yxoes",
        baseUrl: "https://fapi.binance.com",
        wsUrl: "wss://fstream.binance.com/ws",
      },
      scanner: {
        stage0: {
          interval: "1h",
          startTime: "00:06:00.000",
          klinePeriod: "15m",
          minKlines: 300,
          maxKlines: 115000,
          includeTradFi: false,
        },
        stage0P: {
          enabled: false,
          interval: "15m",
          startTime: "00:08:36.000",
          periods: {
            "15m": { enabled: false, count: 7, threshold: -3 },
          },
          abnormalMove: {
            enabled: false,
            lookbackHours: 10,
            windowMinutes: 60,
            maxPump: 25,
            maxDrop: 30,
          }
        },
        stage1: {
          interval: "15m",
          startTime: "00:14:51.300",
          minVolumeM1: 6500000,
          priceChangeK1: [0, 100],
          whitelist: [],
          blacklist: [],
        },
        stage2: {
          interval: "15m",
          startTime: "00:14:59.600",
          cooldown: 0,
          preferredMode: 'volume',
          conditions: {
            k2: { enabled: true, range: [4, 8.85] },
            a: { 
              enabled: true, 
              mode: 'fixed', 
              fixedRange: [0, 3],
              relativeRange: [0, 50]
            },
            m: { enabled: true, range: [7000000, 100000000] },
            k5: { enabled: false, range: [0.1, 1] },
          },
        },
        timeControl: {
          enabled: true,
          hours: Array(24).fill(true),
          mode: '+2',
        },
      },
      order: {
        leverage: 5,
        positionRatio: 50,
        maxPosition: 40000,
        tpMode: 'ratio',
        tpRatio: 45,
        tpFixed: 2,
        tpEnabled: true,
        slMode: 'ratio',
        slRatio: 85,
        slFixed: 3,
        slEnabled: true,
        mLinkEnabled: false,
        mLinkValue: 1800,
        positiveWindow: 0.7,
        maxHoldTime: 20,
        kBestPeriod: "15m",
        kBestWindow: [1, 5],
      },
      withdrawal: {
        withdrawalThreshold: 568,
        retentionThreshold: 488,
        alarmThreshold: 5,
      },
    }
  ],
  email: {
    enabled: true,
    sender: "",
    receiver: "",
    smtpServer: "",
    smtpPort: 465,
    password: "",
    minBalance: 5,
    maxConsecutiveLoss: 30000,
  },
  auth: {
    username: "admin",
    password: "Xiemac123!",
  },
};
