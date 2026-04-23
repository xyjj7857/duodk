import { AppSettings } from "./types";

export const APP_NAME = "超强49";

export const DEFAULT_SETTINGS: AppSettings = {
  appName: APP_NAME,
  accounts: [
    {
      id: "main",
      name: "2000",
      enabled: true,
      binance: {
        apiKey: "H7zkNQdrS9TIGWXiZEBaGjpQz6HSmku8rxKDOli11Vt01Im7JRGZO6niWiqbm4pB",
        secretKey: "4YGbbbJPKXKfT3KkxHd8TvC1cBaGuaXdTdaRZNKNNjzxJlSInzNxqNgpFhqOBG6f",
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
          minVolumeM1: 18500000,
          priceChangeK1: [0, 100],
          whitelist: [],
          blacklist: [],
        },
        stage2: {
          interval: "15m",
          startTime: "00:14:59.700",
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
            m: { enabled: true, range: [19800000, 100000000] },
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
        maxHoldTime: 120,
        kBestPeriod: "15m",
        kBestWindow: [1, 5],
      },
      withdrawal: {
        withdrawalThreshold: 2088,
        retentionThreshold: 1888,
        alarmThreshold: 5,
      },
    },
    {
      id: "1",
      name: "4-9-7-20-pl",
      enabled: true,
      binance: {
        apiKey: "yBd9wVfEmdS9LvS45HhhHsetcnbqTTclnwCvb9p40RmsQNX9MWOAyVuA6hU7kHIL",
        secretKey: "bl3aoCvJldS5DrahPFVVj90X5eL8cgwMMQbCDXvGLO1b20Smp5u8TLcjVAZpPf7S",
        baseUrl: "https://fapi.binance.com",
        wsUrl: "wss://fstream.binance.com/ws",
      },
      scanner: {
        stage0: {
          interval: "1h",
          startTime: "00:21:00.000",
          klinePeriod: "15m",
          minKlines: 300,
          maxKlines: 115000,
          includeTradFi: false,
        },
        stage0P: {
          enabled: false,
          interval: "15m",
          startTime: "00:09:36.000",
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
          startTime: "00:14:51.600",
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
    },
    {
      id: "2",
      name: "4-9-7-20-p",
      enabled: true,
      binance: {
        apiKey: "RiSgQhhUL4WPCbO4qXAvR2NEkBitprjoAZtYXxpwnuryQl6CZ29qDF18hK0ecC7b",
        secretKey: "pLD9a2O55Eob1NXQif3HqSVbYj9feGY2LwS95AF2gVAsxZn5qG40W3SJXcwaBsYx",
        baseUrl: "https://fapi.binance.com",
        wsUrl: "wss://fstream.binance.com/ws",
      },
      scanner: {
        stage0: {
          interval: "1h",
          startTime: "00:36:00.000",
          klinePeriod: "15m",
          minKlines: 300,
          maxKlines: 115000,
          includeTradFi: false,
        },
        stage0P: {
          enabled: false,
          interval: "15m",
          startTime: "00:10:36.000",
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
        slEnabled: false,
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
