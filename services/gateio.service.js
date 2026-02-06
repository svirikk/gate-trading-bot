import crypto from 'crypto';
import axios from 'axios';
import { config } from '../config/settings.js';
import logger from '../utils/logger.js';

class GateIOService {
  constructor() {
    this.baseURL = config.gateio.baseURL;
    this.apiKey = config.gateio.apiKey;
    this.apiSecret = config.gateio.apiSecret;
    this.isConnected = false;
  }

  /**
   * Створює HMAC-SHA512 підпис для автентифікації
   */
  generateSignature(method, endpoint, queryString, bodyString, timestamp) {
    // Обчислюємо SHA512 хеш від body
    const bodyHash = crypto
      .createHash('sha512')
      .update(bodyString || '')
      .digest('hex');

    // ВАЖЛИВО: endpoint вже містить /api/v4, НЕ додаємо його знову!
    // Формуємо signature string згідно документації
    const signatureString = `${method}\n${endpoint}\n${queryString}\n${bodyHash}\n${timestamp}`;

    // Створюємо HMAC-SHA512 підпис
    const signature = crypto
      .createHmac('sha512', this.apiSecret)
      .update(signatureString)
      .digest('hex');

    logger.info('[GATEIO] Signature generation:');
    logger.info(`  Method: ${method}`);
    logger.info(`  Endpoint: ${endpoint}`);
    logger.info(`  Query: ${queryString || '(empty)'}`);
    logger.info(`  Body hash: ${bodyHash}`);
    logger.info(`  Timestamp: ${timestamp}`);
    logger.info(`  Signature string: ${signatureString.replace(/\n/g, '\\n')}`);

    return signature;
  }

  /**
   * Формує query string з параметрів (у правильному порядку та з кодуванням)
   */
  buildQueryString(queryParams = {}) {
    const params = new URLSearchParams();

    Object.keys(queryParams)
      .sort()
      .forEach(key => {
        const value = queryParams[key];
        if (value === undefined || value === null) return;

        if (Array.isArray(value)) {
          value.forEach(item => params.append(key, String(item)));
          return;
        }

        params.append(key, String(value));
      });

    return params.toString();
  }

  /**
   * Виконує PUBLIC запит (без автентифікації)
   */
  async publicRequest(method, endpoint) {
    const url = `${this.baseURL}${endpoint}`;

    try {
      logger.info(`[GATEIO] PUBLIC REQUEST:`);
      logger.info(`  Method: ${method}`);
      logger.info(`  URL: ${url}`);

      const response = await axios({
        method,
        url,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      logger.info(`[GATEIO] PUBLIC RESPONSE:`);
      logger.info(`  Status: ${response.status}`);
      logger.info(`  Headers: ${JSON.stringify(response.headers)}`);
      logger.info(`  Body: ${JSON.stringify(response.data).substring(0, 500)}...`);

      return response.data;
    } catch (error) {
      logger.error(`[GATEIO] PUBLIC REQUEST ERROR:`);
      logger.error(`  Status: ${error.response?.status}`);
      logger.error(`  Message: ${error.message}`);
      logger.error(`  Response: ${JSON.stringify(error.response?.data)}`);
      throw error;
    }
  }

  /**
   * Виконує PRIVATE запит (з автентифікацією)
   */
  async privateRequest(method, endpoint, queryParams = {}, body = null) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const normalizedMethod = method.toUpperCase();
    
    // Для підпису використовуємо повний path з /api/v4
    const signaturePath = `/api/v4${endpoint}`;
    
    const queryString = this.buildQueryString(queryParams);
    
    const bodyString = body ? JSON.stringify(body) : '';
    const signature = this.generateSignature(normalizedMethod, signaturePath, queryString, bodyString, timestamp);

    const url = `${this.baseURL}${endpoint}${queryString ? '?' + queryString : ''}`;

    const headers = {
      'KEY': this.apiKey,
      'Timestamp': timestamp,
      'SIGN': signature,
      'Content-Type': 'application/json'
    };

    try {
      logger.info(`[GATEIO] PRIVATE REQUEST:`);
      logger.info(`  Method: ${normalizedMethod}`);
      logger.info(`  URL: ${url}`);
      logger.info(`  Headers (без секретів):`);
      logger.info(`    KEY: ${this.apiKey.substring(0, 10)}...`);
      logger.info(`    Timestamp: ${timestamp}`);
      logger.info(`    SIGN: ${signature.substring(0, 20)}...`);
      logger.info(`  Body: ${bodyString || '(empty)'}`);

      const response = await axios({
        method: normalizedMethod,
        url,
        headers,
        data: body || undefined
      });

      logger.info(`[GATEIO] PRIVATE RESPONSE:`);
      logger.info(`  Status: ${response.status}`);
      logger.info(`  Body: ${JSON.stringify(response.data).substring(0, 500)}...`);

      return response.data;
    } catch (error) {
      logger.error(`[GATEIO] PRIVATE REQUEST ERROR:`);
      logger.error(`  Status: ${error.response?.status}`);
      logger.error(`  Message: ${error.message}`);
      logger.error(`  Response: ${JSON.stringify(error.response?.data)}`);
      throw error;
    }
  }

  /**
   * Конвертує символ з формату BTCUSDT в BTC_USDT
   */
  formatSymbol(symbol) {
    if (!symbol) return '';
    return symbol.replace(/USDT$/, '_USDT');
  }

  /**
   * Конвертує символ назад з формату BTC_USDT в BTCUSDT
   */
  unformatSymbol(symbol) {
    if (!symbol) return '';
    return symbol.replace(/_USDT$/, 'USDT');
  }

  /**
   * КРОК 1: PUBLIC TEST - список контрактів
   */
  async testPublicConnection() {
    try {
      logger.info('[GATEIO] ========================================');
      logger.info('[GATEIO] STEP 1: PUBLIC CONNECTION TEST');
      logger.info('[GATEIO] ========================================');

      const contracts = await this.publicRequest('GET', '/futures/usdt/contracts');

      if (contracts && Array.isArray(contracts) && contracts.length > 0) {
        logger.info(`[GATEIO] ✅ PUBLIC TEST PASSED`);
        logger.info(`[GATEIO] Found ${contracts.length} contracts`);
        logger.info(`[GATEIO] Sample: ${contracts[0].name}`);
        return true;
      } else {
        throw new Error('Invalid public response');
      }
    } catch (error) {
      logger.error(`[GATEIO] ❌ PUBLIC TEST FAILED: ${error.message}`);
      throw error;
    }
  }

  /**
   * КРОК 2: PRIVATE AUTH TEST - баланс акаунта
   */
  async testPrivateConnection() {
    try {
      logger.info('[GATEIO] ========================================');
      logger.info('[GATEIO] STEP 2: PRIVATE AUTH TEST');
      logger.info('[GATEIO] ========================================');

      const account = await this.privateRequest('GET', '/futures/usdt/accounts');

      if (account && account.total !== undefined) {
        logger.info(`[GATEIO] ✅ PRIVATE AUTH TEST PASSED`);
        logger.info(`[GATEIO] Account total: ${account.total} USDT`);
        logger.info(`[GATEIO] Account available: ${account.available} USDT`);
        return true;
      } else {
        throw new Error('Invalid private response');
      }
    } catch (error) {
      logger.error(`[GATEIO] ❌ PRIVATE AUTH TEST FAILED: ${error.message}`);
      throw error;
    }
  }

  /**
   * Головний метод підключення
   */
  async connect() {
    try {
      logger.info('[GATEIO] ========================================');
      logger.info('[GATEIO] CONNECTING TO GATE.IO API v4');
      logger.info('[GATEIO] ========================================');
      logger.info(`[GATEIO] Base URL: ${this.baseURL}`);
      logger.info(`[GATEIO] API Key: ${this.apiKey.substring(0, 10)}...`);
      logger.info(`[GATEIO] Position mode: ${config.gateio.positionMode}`);

      // КРОК 1: Public test
      await this.testPublicConnection();

      // КРОК 2: Private auth test
      await this.testPrivateConnection();

      this.isConnected = true;
      logger.info('[GATEIO] ========================================');
      logger.info('[GATEIO] ✅ CONNECTION SUCCESSFUL');
      logger.info('[GATEIO] ========================================');

      return true;
    } catch (error) {
      this.isConnected = false;
      logger.error('[GATEIO] ========================================');
      logger.error('[GATEIO] ❌ CONNECTION FAILED');
      logger.error('[GATEIO] ========================================');
      throw error;
    }
  }

  /**
   * Отримує баланс USDT на Futures акаунті
   */
  async getUSDTBalance() {
    try {
      const account = await this.privateRequest('GET', '/futures/usdt/accounts');
      const availableBalance = parseFloat(account.available || '0');
      
      logger.info(`[GATEIO] USDT Balance: ${availableBalance} USDT`);
      
      return availableBalance;
    } catch (error) {
      logger.error(`[GATEIO] Error getting balance: ${error.message}`);
      throw error;
    }
  }

  /**
   * Отримує інформацію про контракт
   */
  async getSymbolInfo(symbol) {
    try {
      const contract = this.formatSymbol(symbol);
      const contractInfo = await this.publicRequest('GET', `/futures/usdt/contracts/${contract}`);
      
      const orderSizeMin = parseFloat(contractInfo.order_size_min || '1');
      const orderPriceRound = parseFloat(contractInfo.order_price_round || '0.01');
      const pricePrecision = Math.abs(Math.floor(Math.log10(orderPriceRound)));

      return {
        symbol: this.unformatSymbol(contractInfo.name),
        contract: contractInfo.name,
        tickSize: orderSizeMin,
        minQty: parseFloat(contractInfo.order_size_min || '1'),
        maxQty: parseFloat(contractInfo.order_size_max || '1000000'),
        pricePrecision: pricePrecision,
        status: contractInfo.in_delisting ? 'Delisting' : 'Trading'
      };
    } catch (error) {
      logger.error(`[GATEIO] Error getting symbol info for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Отримує поточну ціну символу
   */
  async getCurrentPrice(symbol) {
    try {
      const contract = this.formatSymbol(symbol);
      const tickers = await this.publicRequest('GET', `/futures/usdt/tickers?contract=${contract}`);
      
      if (!tickers || tickers.length === 0) {
        throw new Error(`Ticker for ${contract} not found`);
      }

      const lastPrice = parseFloat(tickers[0].last);
      logger.info(`[GATEIO] Current price for ${symbol}: ${lastPrice}`);
      
      return lastPrice;
    } catch (error) {
      logger.error(`[GATEIO] Error getting current price for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Встановлює плече для контракту
   */
  async setLeverage(symbol, leverage) {
    try {
      logger.info(`[GATEIO] Setting leverage ${leverage}x for ${symbol}...`);
      
      const contract = this.formatSymbol(symbol);
      const body = { leverage: leverage.toString() };

      if (config.gateio.positionMode === 'dual_mode') {
        // Для dual mode встановлюємо окремо для long і short
        await this.privateRequest('POST', `/futures/usdt/positions/${contract}/leverage`, {}, { ...body, mode: 'long' });
        await this.privateRequest('POST', `/futures/usdt/positions/${contract}/leverage`, {}, { ...body, mode: 'short' });
      } else {
        // Для single mode
        await this.privateRequest('POST', `/futures/usdt/positions/${contract}/leverage`, {}, body);
      }
      
      logger.info(`[GATEIO] ✅ Leverage ${leverage}x set for ${symbol}`);
      return true;
    } catch (error) {
      if (error.message?.includes('leverage not modified')) {
        logger.info(`[GATEIO] ✅ Leverage already ${leverage}x for ${symbol}`);
        return true;
      }
      logger.error(`[GATEIO] Error setting leverage: ${error.message}`);
      throw error;
    }
  }

  /**
   * Відкриває Market ордер
   */
  async openMarketOrder(symbol, side, quantity, direction = null) {
    try {
      logger.info(`[GATEIO] Opening ${side} market order: ${quantity} ${symbol}...`);
      
      const contract = this.formatSymbol(symbol);
      const size = side === 'Buy' ? Math.abs(quantity) : -Math.abs(quantity);
      
      const order = {
        contract: contract,
        size: size,
        price: '0',
        tif: 'ioc',
        text: `t-${Date.now()}`
      };
      
      const response = await this.privateRequest('POST', '/futures/usdt/orders', {}, order);
      
      const orderId = response.id?.toString() || '';
      logger.info(`[GATEIO] ✅ Market order opened: Order ID ${orderId}`);
      
      return {
        orderId: orderId,
        orderLinkId: response.text,
        symbol: symbol,
        side: side,
        quantity: Math.abs(quantity)
      };
    } catch (error) {
      logger.error(`[GATEIO] Error opening market order: ${error.message}`);
      throw error;
    }
  }

  /**
   * Встановлює Take Profit через Limit ордер
   */
  async setTakeProfitLimit(symbol, side, price, quantity, direction) {
    try {
      logger.info(`[GATEIO] Setting Take Profit limit order @ ${price} for ${symbol}...`);
      
      const contract = this.formatSymbol(symbol);
      const closeSize = direction === 'LONG' ? -Math.abs(quantity) : Math.abs(quantity);
      
      const order = {
        contract: contract,
        size: closeSize,
        price: price.toString(),
        tif: 'gtc',
        reduce_only: true,
        text: `tp-${Date.now()}`
      };
      
      const response = await this.privateRequest('POST', '/futures/usdt/orders', {}, order);
      
      const orderId = response.id?.toString() || 'TP_LIMIT';
      logger.info(`[GATEIO] ✅ Take Profit limit order set: Order ID ${orderId}`);
      
      return {
        orderId: orderId,
        price: price
      };
    } catch (error) {
      logger.error(`[GATEIO] Error setting Take Profit: ${error.message}`);
      throw error;
    }
  }

  /**
   * Встановлює Stop Loss через Price-Triggered ордер
   */
  async setStopLossLimit(symbol, side, price, quantity, direction) {
    try {
      logger.info(`[GATEIO] Setting Stop Loss price-triggered order @ ${price} for ${symbol}...`);
      
      const contract = this.formatSymbol(symbol);
      const closeSize = direction === 'LONG' ? -Math.abs(quantity) : Math.abs(quantity);
      
      const priceOrder = {
        initial: {
          contract: contract,
          size: closeSize,
          price: price.toString(),
          tif: 'gtc',
          reduce_only: true,
          text: `sl-${Date.now()}`
        },
        trigger: {
          strategy_type: 0,
          price_type: 1,
          price: price.toString(),
          rule: direction === 'LONG' ? 2 : 1
        }
      };
      
      const response = await this.privateRequest('POST', '/futures/usdt/price_orders', {}, priceOrder);
      
      const orderId = response.id?.toString() || 'SL_TRIGGERED';
      logger.info(`[GATEIO] ✅ Stop Loss price-triggered order set: Order ID ${orderId}`);
      
      return {
        orderId: orderId,
        price: price
      };
    } catch (error) {
      logger.error(`[GATEIO] Error setting Stop Loss: ${error.message}`);
      throw error;
    }
  }

  /**
   * Отримує відкриті позиції
   */
  async getOpenPositions(symbol = null) {
    try {
      const queryParams = symbol ? { contract: this.formatSymbol(symbol) } : {};
      const positions = await this.privateRequest('GET', '/futures/usdt/positions', queryParams);
      
      return positions
        .filter(pos => parseFloat(pos.size || '0') !== 0)
        .map(pos => {
          const size = parseFloat(pos.size || '0');
          const side = size > 0 ? 'Buy' : 'Sell';
          
          return {
            symbol: this.unformatSymbol(pos.contract),
            contract: pos.contract,
            side: side,
            size: Math.abs(size),
            entryPrice: parseFloat(pos.entry_price || '0'),
            markPrice: parseFloat(pos.mark_price || '0'),
            unrealisedPnl: parseFloat(pos.unrealised_pnl || '0'),
            leverage: parseFloat(pos.leverage || '1'),
            mode: pos.mode || 'single'
          };
        });
    } catch (error) {
      logger.error(`[GATEIO] Error getting open positions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Перевіряє чи є відкрита позиція по символу
   */
  async hasOpenPosition(symbol) {
    const positions = await this.getOpenPositions(symbol);
    return positions.length > 0;
  }

  /**
   * Отримує історію угод
   */
  async getTradeHistory(symbol = null, limit = 50) {
    try {
      const queryParams = { limit: limit };
      if (symbol) {
        queryParams.contract = this.formatSymbol(symbol);
      }

      const trades = await this.privateRequest('GET', '/futures/usdt/my_trades', queryParams);

      return trades.map(trade => ({
        id: trade.id,
        contract: trade.contract,
        symbol: this.unformatSymbol(trade.contract),
        createTime: trade.create_time,
        orderId: trade.order_id,
        size: Math.abs(parseFloat(trade.size || '0')),
        price: parseFloat(trade.price || '0'),
        role: trade.role,
        text: trade.text
      }));
    } catch (error) {
      logger.error(`[GATEIO] Error getting trade history: ${error.message}`);
      throw error;
    }
  }
}

const gateioService = new GateIOService();
export default gateioService;
