import axios from 'axios';
import CryptoJS from 'crypto-js';
import { BinanceSettings } from '../types';

export class BinanceService {
  private settings: BinanceSettings;

  constructor(settings: BinanceSettings) {
    this.settings = settings;
  }

  private getSignature(queryString: string): string {
    return CryptoJS.HmacSHA256(queryString, this.settings.secretKey).toString();
  }

  async getServerTime(): Promise<number> {
    try {
      const response = await axios.get(`${this.settings.baseUrl}/fapi/v1/time`);
      return response.data.serverTime;
    } catch (error: any) {
      console.error('Failed to fetch Binance server time:', error.message);
      return Date.now();
    }
  }

  private async request(method: string, endpoint: string, params: any = {}, signed: boolean = false, overrideBaseUrl?: string) {
    const timestamp = Date.now();
    let queryString = Object.keys(params)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');

    if (signed) {
      queryString += (queryString ? '&' : '') + `timestamp=${timestamp}&recvWindow=10000`;
      const signature = this.getSignature(queryString);
      queryString += `&signature=${signature}`;
    }

    const baseUrl = overrideBaseUrl || this.settings.baseUrl;
    const url = `${baseUrl}${endpoint}${queryString ? '?' + queryString : ''}`;

    try {
      const response = await axios({
        method,
        url,
        headers: {
          'X-MBX-APIKEY': this.settings.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
      });
      return response.data;
    } catch (error: any) {
      const errorData = error.response?.data;
      let errorMessage = error.message;

      if (errorData) {
        if (typeof errorData === 'string' && errorData.includes('<!DOCTYPE html>')) {
          errorMessage = `HTML Response (Likely 404 or Redirect). Check Base URL: ${baseUrl}`;
        } else {
          errorMessage = JSON.stringify(errorData);
        }
      }

      // Only log if it's not a 404 for an optional endpoint
      if (error.response?.status !== 404) {
        console.error(`Binance API Error (${endpoint}):`, errorMessage);
      }
      
      const enhancedError = new Error(errorMessage);
      (enhancedError as any).status = error.response?.status;
      (enhancedError as any).headers = error.response?.headers;
      (enhancedError as any).data = errorData;
      throw enhancedError;
    }
  }

  async getAccountInfo() {
    return this.request('GET', '/fapi/v2/account', {}, true);
  }

  async getPositionRisk() {
    return this.request('GET', '/fapi/v2/positionRisk', {}, true);
  }

  async getExchangeInfo() {
    return this.request('GET', '/fapi/v1/exchangeInfo');
  }

  async getKlines(symbol: string, interval: string, limit: number = 500, options: any = {}) {
    return this.request('GET', '/fapi/v1/klines', { symbol, interval, limit, ...options });
  }

  async getTickerPrice(symbol: string) {
    return this.request('GET', '/fapi/v1/ticker/price', { symbol });
  }

  async placeOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
    quantity: string;
    price?: string;
    stopPrice?: string;
    timeInForce?: 'GTC' | 'IOC' | 'FOK';
    reduceOnly?: string;
  }) {
    return this.request('POST', '/fapi/v1/order', params, true);
  }

  async cancelOrder(symbol: string, orderId: number) {
    return this.request('DELETE', '/fapi/v1/order', { symbol, orderId }, true);
  }

  async cancelAllOpenOrders(symbol: string) {
    return this.request('DELETE', '/fapi/v1/allOpenOrders', { symbol }, true);
  }

  async getOpenOrders(symbol?: string) {
    return this.request('GET', '/fapi/v1/openOrders', symbol ? { symbol } : {}, true);
  }

  /**
   * 下 Algo 委托单
   * 接口: POST /fapi/v1/algoOrder
   */
  async createAlgoOrder(params: {
    symbol: string;                  // 交易对，如 BTCUSDT
    side: 'BUY' | 'SELL';            // 买卖方向
    algoType: 'VP' | 'TWAP' | 'CONDITIONAL'; // 算法类型
    type: 'STOP_MARKET' | 'TAKE_PROFIT_MARKET'; // 订单类型
    quantity?: string;               // 数量
    stopPrice?: string;              // 止损价
    triggerPrice?: string;           // 触发价
    reduceOnly?: string;             // 是否只减仓
    workingType?: 'MARK_PRICE' | 'CONTRACT_PRICE'; // 价格类型
    [key: string]: any;              // 其他扩展参数
  }) {
    return this.request('POST', '/fapi/v1/algoOrder', params, true);
  }

  /**
   * 获取当前挂着的 Algo 委托单
   * 接口: GET /fapi/v1/openAlgoOrders
   */
  async getOpenAlgoOrders() {
    return this.request('GET', '/fapi/v1/openAlgoOrders', {}, true);
  }

  /**
   * 撤销 Algo 委托单
   * 接口: DELETE /fapi/v1/algoOrder
   */
  async cancelAlgoOrder(symbol: string, algoId: number) {
    return this.request('DELETE', '/fapi/v1/algoOrder', { symbol, algoId }, true);
  }

  async getListenKey() {
    const data = await this.request('POST', '/fapi/v1/listenKey', {}, false);
    return data.listenKey;
  }

  async keepAliveListenKey() {
    return this.request('PUT', '/fapi/v1/listenKey', {}, false);
  }

  async transferToSpot(amount: string) {
    // 划转接口在 api.binance.com (SAPI)
    return await this.request('POST', '/sapi/v1/futures/transfer', {
      asset: 'USDT',
      amount,
      type: 2 // 2: USDT-M Futures to Spot
    }, true, 'https://api.binance.com');
  }

  async transferToFutures(amount: string) {
    // 划转接口在 api.binance.com (SAPI)
    return await this.request('POST', '/sapi/v1/futures/transfer', {
      asset: 'USDT',
      amount,
      type: 1 // 1: Spot to USDT-M Futures
    }, true, 'https://api.binance.com');
  }

  async getSpotAccountInfo() {
    return await this.request('GET', '/api/v3/account', {}, true, 'https://api.binance.com');
  }

  async getUserTrades(symbol: string, limit: number = 100, startTime?: number, endTime?: number) {
    const params: any = { symbol, limit };
    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;
    return this.request('GET', '/fapi/v1/userTrades', params, true);
  }

  async getAllOrders(symbol: string, limit: number = 100, startTime?: number, endTime?: number) {
    const params: any = { symbol, limit };
    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;
    return this.request('GET', '/fapi/v1/allOrders', params, true);
  }

  async getIncomeHistory(params: {
    symbol?: string;
    incomeType?: 'TRANSFER' | 'WELCOME_BONUS' | 'REALIZED_PNL' | 'FUNDING_FEE' | 'COMMISSION' | 'INSURANCE_CLEAR' | 'REFERRAL_KICKBACK' | 'COMMISSION_REBATE' | 'API_REBATE' | 'CONTEST_REWARD' | 'CROSS_COLLATERAL_TRANSFER' | 'OPTIONS_PREMIUM_FEE' | 'OPTIONS_SETTLE_PROFIT' | 'TUSD_CASHED' | 'BUSD_CASHED' | 'AUTO_EXCHANGE' | 'DELIVERED_SETTELMENT' | 'COIN_SWAP_DEPOSIT' | 'COIN_SWAP_WITHDRAW' | 'POSITION_REVENUE' | 'ASSET_REVENUE' | 'USER_REVENUE' | 'OPERATIONAL_REVENUE' | 'INCOME_REVENUE' | 'STAKING_REVENUE' | 'LOAN_CONFISCATED' | 'FEE_RETURN' | 'SESSION_SETTLEMENT' | 'APOLLO_REBATE' | 'DELIVERY_EDICT' | 'DELIVERY_FEE' | 'DELIVERY_IB_REBATE' | 'LATENCY_FEE' | 'NET_ASSET_VALUE_CAP_FEE' | 'DUAL_INVESTMENT_REVENUE' | 'DUAL_INVESTMENT_PAYMENT' | 'BNB_CONVERT';
    startTime?: number;
    endTime?: number;
    limit?: number;
  }) {
    return this.request('GET', '/fapi/v1/income', params, true);
  }
}
