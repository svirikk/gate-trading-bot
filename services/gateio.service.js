import crypto from 'crypto';
import axios from 'axios';
import { config } from '../config/settings.js';
import logger from '../utils/logger.js';

/**
 * Gate.io Futures API v4 Service
 * Офіційна документація: https://www.gate.io/docs/developers/futures/
 */
class GateIOService {
  constructor() {
    this.baseURL = 'https://api.gateio.ws';
    this.apiPrefix = '/api/v4';
    this.apiKey = config.gateio.apiKey;
    this.apiSecret = config.gateio.apiSecret;
    this.isConnected = false;
  }

  /**
   * Генерує HMAC-SHA512 підпис згідно Gate.io API v4 документації
   * 
   * Signature formula:
   * prehash = METHOD + "\n" + RESOURCE_PATH + "\n" + QUERY_STRING + "\n" + BODY_HASH + "\n" + TIMESTAMP
   * SIGN = HMAC_SHA512(API_SECRET, prehash)
   */
  generateSignature(method, resourcePath, queryString, bodyString, timestamp) {
    // 1. Хешуємо body з SHA512
    const bodyHash = crypto
      .createHash('sha512')
      .update(bodyString)
      .digest('hex');

    // 2. Формуємо prehash string
    const prehashParts = [
      method,
      resourcePath,
      queryString,
      bodyHash,
      timestamp
    ];
    const prehashString = prehashParts.join('\n');

    // 3. HMAC-SHA512 підпис
    const signature = crypto
      .createHmac('sha512', this.apiSecret)
      .update(prehashString)
      .digest('hex');

    logger.info('[GATEIO] ━━━ SIGNATURE DEBUG ━━━');
    logger.info(`  Method: ${method}`);
    logger.info(`  Resource Path: ${resourcePath}`);
    logger.info(`  Query String: "${queryString}"`);
    logger.info(`  Body: ${bodyString || '(empty)'}`);
    logger.info(`  Body Hash: ${bodyHash}`);
    logger.info(`  Timestamp: ${timestamp}`);
    logger.info(`  Prehash: ${prehashString.replace(/\n/g, '\\n')}`);
    logger.info(`  Signature: ${signature.substring(0, 40)}...`);

    return signature;
  }

  /**
   * PUBLIC запит (без автентифікації)
   */
  async publicRequest(method, endpoint) {
    const url = `${this.baseURL}${this.apiPrefix}${endpoint}`;

    try {
      logger.info('[GATEIO] ═══ PUBLIC REQUEST ═══');
      logger.info(`  ${method} ${url}`);

      const response = await axios({
        method,
        url,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      logger.info('[GATEIO] ═══ PUBLIC RESPONSE ═══');
      logger.info(`  Status: ${response.status}`);
      logger.info(`  Data: ${JSON.stringify(response.data).substring(0, 300)}...`);

      return response.data;
    } catch (error) {
      logger.error('[GATEIO] ✗✗✗ PUBLIC ERROR ✗✗✗');
      logger.error(`  Status: ${error.response?.status}`);
      logger.error(`  Message: ${error.message}`);
      logger.error(`  Response: ${JSON.stringify(error.response?.data)}`);
      throw error;
    }
  }

  /**
   * PRIVATE запит (з HMAC-SHA512 автентифікацією)
   */
  async privateRequest(method, endpoint, queryParams = {}, body = null) {
    const timestamp = Math.floor(Date.now() / 1000).toString(); // ВАЖЛИВО: секунди, НЕ мілісекунди

    // Resource path для підпису: /api/v4/futures/usdt/...
    const resourcePath = `${this.apiPrefix}${endpoint}`;

    // Query string (ВАЖЛИВО: сортуємо ключі!)
    const queryString = Object.keys(queryParams).length > 0
      ? Object.keys(queryParams)
          .sort()
          .map(k => `${k}=${encodeURIComponent(queryParams[k])}`)
          .join('&')
      : '';

    // Body string (для GET завжди пусто)
    const bodyString = body ? JSON.stringify(body) : '';

    // Генеруємо підпис
    const signature = this.generateSignature(
      method,
      resourcePath,
      queryString,
      bodyString,
      timestamp
    );

    // Повний URL
    const url = `${this.baseURL}${resourcePath}${queryString ? '?' + queryString : ''}`;

    // Headers згідно документації
    const headers = {
      'KEY': this.apiKey,
      'Timestamp': timestamp,
      'SIGN': signature,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    try {
      logger.info('[GATEIO] ═══ PRIVATE REQUEST ═══');
      logger.info(`  ${method} ${url}`);
      logger.info(`  KEY: ${this.apiKey.substring(0, 15)}...`);
      logger.info(`  Timestamp: ${timestamp}`);
      logger.info(`  SIGN: ${signature.substring(0, 40)}...`);
      if (bodyString) logger.info(`  Body: ${bodyString}`);

      const response = await axios({
        method,
        url,
        headers,
        data: bodyString || undefined
      });

      logger.info('[GATEIO] ═══ PRIVATE RESPONSE ═══');
      logger.info(`  Status: ${response.status}`);
      logger.info(`  Data: ${JSON.stringify(response.data).substring(0, 500)}...`);

      return response.data;
    } catch (error) {
      logger.error('[GATEIO] ✗✗✗ PRIVATE ERROR ✗✗✗');
      logger.error(`  Status: ${error.response?.status || 'N/A'}`);
      logger.error(`  Message: ${error.message}`);
      logger.error(`  Response: ${JSON.stringify(error.response?.data)}`);
      logger.error(`  Headers: ${JSON.stringify(error.response?.headers)}`);
      throw error;
    }
  }

  /**
   * Конвертує BTCUSDT → BTC_USDT
   */
  formatSymbol(symbol) {
    if (!symbol) return '';
    return symbol.replace('USDT', '_USDT');
  }

  /**
   * Конвертує BTC_USDT → BTCUSDT
   */
  unformatSymbol(symbol) {
    if (!symbol) return '';
    return symbol.replace('_USDT', 'USDT');
  }

  /**
   * КРОК 1: PUBLIC TEST
   */
  async testPublicConnection() {
    try {
      logger.info('');
      logger.info('[GATEIO] ╔═══════════════════════════════╗');
      logger.info('[GATEIO] ║   STEP 1: PUBLIC TEST         ║');
      logger.info('[GATEIO] ╚═══════════════════════════════╝');

      const contracts = await this.publicRequest('GET', '/futures/usdt/contracts');

      if (Array.isArray(contracts) && contracts.length > 0) {
        logger.info(`[GATEIO] ✓ Found ${contracts.length} contracts`);
        logger.info(`[GATEIO] ✓ Sample: ${contracts[0].name}`);
        logger.info('[GATEIO] ✓✓✓ PUBLIC TEST PASSED ✓✓✓');
        return true;
      }

      throw new Error('Invalid public response');
    } catch (error) {
      logger.error('[GATEIO] ✗✗✗ PUBLIC TEST FAILED ✗✗✗');
      throw error;
    }
  }

  /**
   * КРОК 2: PRIVATE AUTH TEST
   */
  async testPrivateConnection() {
    try {
      logger.info('');
      logger.info('[GATEIO] ╔═══════════════════════════════╗');
      logger.info('[GATEIO] ║   STEP 2: PRIVATE AUTH TEST   ║');
      logger.info('[GATEIO] ╚═══════════════════════════════╝');

      const account = await this.privateRequest('GET', '/futures/usdt/accounts');

      if (account && account.total !== undefined) {
        logger.info(`[GATEIO] ✓ Total: ${account.total} USDT`);
        logger.info(`[GATEIO] ✓ Available: ${account.available} USDT`);
        logger.info('[GATEIO] ✓✓✓ PRIVATE AUTH TEST PASSED ✓✓✓');
        return true;
      }

      throw new Error('Invalid private response');
    } catch (error) {
      logger.error('[GATEIO] ✗✗✗ PRIVATE AUTH TEST FAILED ✗✗✗');
      throw error;
    }
  }

  /**
   * CONNECT - головна точка входу
   */
  async connect() {
    try {
      logger.info('');
      logger.info('[GATEIO] ╔════════════════════════════════════╗');
      logger.info('[GATEIO] ║  CONNECTING TO GATE.IO API v4      ║');
      logger.info('[GATEIO] ╚════════════════════════════════════╝');
      logger.info(`[GATEIO] Base URL: ${this.baseURL}${this.apiPrefix}`);
      logger.info(`[GATEIO] API Key: ${this.apiKey.substring(0, 20)}...`);
      logger.info(`[GATEIO] Position Mode: ${config.gateio.positionMode}`);

      // КРОК 1: Public test
      await this.testPublicConnection();

      // КРОК 2: Private auth test
      await this.testPrivateConnection();

      this.isConnected = true;
      logger.info('');
      logger.info('[GATEIO] ╔════════════════════════════════════╗');
      logger.info('[GATEIO] ║  ✓✓✓ CONNECTION SUCCESSFUL ✓✓✓    ║');
      logger.info('[GATEIO] ╚════════════════════════════════════╝');
      logger.info('');

      return true;
    } catch (error) {
      this.isConnected = false;
      logger.error('');
      logger.error('[GATEIO] ╔════════════════════════════════════╗');
      logger.error('[GATEIO] ║  ✗✗✗ CONNECTION FAILED ✗✗✗         ║');
      logger.error('[GATEIO] ╚════════════════════════════════════╝');
      logger.error('');
      throw error;
    }
  }

  /**
   * Отримує баланс
   */
  async getUSDTBalance() {
    try {
      const account = await this.privateRequest('GET', '/futures/usdt/accounts');
      const balance = parseFloat(account.available || '0');
      logger.info(`[GATEIO] Balance: ${balance} USDT`);
      return balance;
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
      const info = await this.publicRequest('GET', `/futures/usdt/contracts/${contract}`);

      // order_size_min це МІНІМАЛЬНА кількість контрактів (INTEGER)
      const minQty = parseInt(info.order_size_min || '1');
      const maxQty = parseInt(info.order_size_max || '1000000');

      // order_price_round для precision ціни
      const orderPriceRound = parseFloat(info.order_price_round || '0.01');
      const pricePrecision = Math.abs(Math.floor(Math.log10(orderPriceRound)));

      return {
        symbol: this.unformatSymbol(info.name),
        contract: info.name,
        minQty: minQty,
        maxQty: maxQty,
        tickSize: minQty, // Для сумісності з існуючим кодом
        pricePrecision: pricePrecision,
        status: info.in_delisting ? 'Delisting' : 'Trading',
        quantoMultiplier: parseFloat(info.quanto_multiplier || '0.0001') // Для конвертації USD → contracts
      };
    } catch (error) {
      logger.error(`[GATEIO] Error getting symbol info: ${error.message}`);
      throw error;
    }
  }

  /**
   * Отримує поточну ціну
   */
  async getCurrentPrice(symbol) {
    try {
      const contract = this.formatSymbol(symbol);
      const tickers = await this.publicRequest('GET', `/futures/usdt/tickers?contract=${contract}`);

      if (!tickers || tickers.length === 0) {
        throw new Error(`Ticker for ${contract} not found`);
      }

      const price = parseFloat(tickers[0].last);
      logger.info(`[GATEIO] Price ${symbol}: ${price}`);
      return price;
    } catch (error) {
      logger.error(`[GATEIO] Error getting price: ${error.message}`);
      throw error;
    }
  }

  /**
   * Встановлює leverage
   * 
   * ⚠️ ВАЖЛИВО: leverage передається як QUERY PARAMETER, НЕ в body!
   * Правильний формат: POST /futures/usdt/positions/{contract}/leverage?leverage=20
   * 
   * Згідно офіційної документації Gate.io:
   * https://www.gate.io/docs/developers/apiv4/en/
   */
  async setLeverage(symbol, leverage) {
    try {
      logger.info(`[GATEIO] Setting leverage ${leverage}x for ${symbol}...`);

      const contract = this.formatSymbol(symbol);

      // ✅ ВИПРАВЛЕНО: leverage як query parameter
      const queryParams = {
        leverage: leverage.toString()
      };

      if (config.gateio.positionMode === 'dual_mode') {
        // Dual mode: окремо для long і short через інший метод
        try {
          // Для dual mode використовуємо інший endpoint
          await this.privateRequest('POST', `/futures/usdt/dual_mode/positions/${contract}/leverage`, queryParams);
        } catch (error) {
          // Якщо dual_mode endpoint не працює, пробуємо звичайний
          logger.warn('[GATEIO] Dual mode endpoint failed, trying regular...');
          await this.privateRequest('POST', `/futures/usdt/positions/${contract}/leverage`, queryParams);
        }
      } else {
        // Single mode - БЕЗ body, тільки query params
        await this.privateRequest('POST', `/futures/usdt/positions/${contract}/leverage`, queryParams);
      }

      logger.info(`[GATEIO] ✓ Leverage ${leverage}x set`);
      return true;
    } catch (error) {
      // Якщо leverage вже встановлений - OK
      if (error.response?.data?.label === 'INVALID_PARAM_VALUE') {
        logger.info(`[GATEIO] ✓ Leverage already ${leverage}x`);
        return true;
      }
      logger.error(`[GATEIO] Error setting leverage: ${error.message}`);
      throw error;
    }
  }

  /**
   * MARKET ORDER - відкриває позицію
   * 
   * ВАЖЛИВО:
   * - size має бути INTEGER (кількість контрактів, НЕ USDT!)
   * - size > 0 для LONG, size < 0 для SHORT
   * - price = "0" для market order
   * - tif = "ioc" для market order
   */
  async openMarketOrder(symbol, side, quantity, direction) {
    try {
      logger.info(`[GATEIO] Opening ${direction} market order: ${quantity} contracts of ${symbol}...`);

      const contract = this.formatSymbol(symbol);

      // ВАЖЛИВО: size має бути INTEGER і знак визначає напрямок
      const size = direction === 'LONG'
        ? Math.abs(Math.floor(quantity))
        : -Math.abs(Math.floor(quantity));

      const order = {
        contract: contract,
        size: size,          // INTEGER: додатний для LONG, від'ємний для SHORT
        price: '0',          // "0" для market згідно документації
        tif: 'ioc',          // immediate-or-cancel
        text: `t-entry-${Date.now()}`,  // ВАЖЛИВО: має починатися з "t-"
        reduce_only: false   // Відкриваємо нову позицію
      };

      logger.info(`[GATEIO] Order payload: ${JSON.stringify(order)}`);

      const response = await this.privateRequest('POST', '/futures/usdt/orders', {}, order);

      logger.info(`[GATEIO] ✓ Market order opened: ID ${response.id}`);
      logger.info(`[GATEIO] Order details: ${JSON.stringify(response)}`);

      return {
        orderId: response.id?.toString() || '',
        orderLinkId: response.text,
        symbol: symbol,
        side: side,
        quantity: Math.abs(size)
      };
    } catch (error) {
      logger.error(`[GATEIO] Error opening market order: ${error.message}`);
      logger.error(`[GATEIO] Error details: ${JSON.stringify(error.response?.data)}`);
      throw error;
    }
  }

  /**
   * TAKE PROFIT - limit ордер з reduce_only=true
   * 
   * ВАЖЛИВО:
   * - reduce_only = true (закриває існуючу позицію)
   * - size ПРОТИЛЕЖНИЙ напрямку позиції (LONG → negative, SHORT → positive)
   * - tif = "gtc" (good-til-cancelled)
   */
  async setTakeProfitLimit(symbol, side, price, quantity, direction) {
    try {
      logger.info(`[GATEIO] Setting TP limit @ ${price} for ${symbol}...`);

      const contract = this.formatSymbol(symbol);

      // Закриваємо позицію: LONG → sell (негативний), SHORT → buy (позитивний)
      const closeSize = direction === 'LONG'
        ? -Math.abs(Math.floor(quantity))
        : Math.abs(Math.floor(quantity));

      const order = {
        contract: contract,
        size: closeSize,
        price: price.toString(),
        tif: 'gtc',
        reduce_only: true,  // ОБОВ'ЯЗКОВО для TP!
        text: `t-tp-${Date.now()}`  // ВАЖЛИВО: має починатися з "t-"
      };

      logger.info(`[GATEIO] TP order payload: ${JSON.stringify(order)}`);

      const response = await this.privateRequest('POST', '/futures/usdt/orders', {}, order);

      logger.info(`[GATEIO] ✓ TP limit set: ID ${response.id}`);

      return {
        orderId: response.id?.toString() || '',
        price: price
      };
    } catch (error) {
      logger.error(`[GATEIO] Error setting TP: ${error.message}`);
      logger.error(`[GATEIO] Error details: ${JSON.stringify(error.response?.data)}`);
      throw error;
    }
  }

  /**
   * STOP LOSS - price-triggered order
   * 
   * ВАЖЛИВО:
   * - використовуємо /futures/usdt/price_orders endpoint
   * - trigger.price_type = 1 (mark price, безпечніше для SL)
   * - trigger.rule: 1 для >= (SHORT SL), 2 для <= (LONG SL)
   * - initial.reduce_only = true
   */
  async setStopLossLimit(symbol, side, price, quantity, direction) {
    try {
      logger.info(`[GATEIO] Setting SL price-triggered @ ${price} for ${symbol}...`);

      const contract = this.formatSymbol(symbol);

      const closeSize = direction === 'LONG'
        ? -Math.abs(Math.floor(quantity))
        : Math.abs(Math.floor(quantity));

      const priceOrder = {
        initial: {
          contract: contract,
          size: closeSize,
          price: price.toString(),
          tif: 'gtc',
          reduce_only: true,  // ОБОВ'ЯЗКОВО!
          text: `t-sl-${Date.now()}`  // ВАЖЛИВО: має починатися з "t-"
        },
        trigger: {
          strategy_type: 0,   // 0 = price trigger
          price_type: 1,      // 1 = mark price (безпечніше)
          price: price.toString(),
          rule: direction === 'LONG' ? 2 : 1  // LONG: <=, SHORT: >=
        }
      };

      logger.info(`[GATEIO] SL order payload: ${JSON.stringify(priceOrder)}`);

      const response = await this.privateRequest('POST', '/futures/usdt/price_orders', {}, priceOrder);

      logger.info(`[GATEIO] ✓ SL triggered set: ID ${response.id}`);

      return {
        orderId: response.id?.toString() || '',
        price: price
      };
    } catch (error) {
      logger.error(`[GATEIO] Error setting SL: ${error.message}`);
      logger.error(`[GATEIO] Error details: ${JSON.stringify(error.response?.data)}`);
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
          return {
            symbol: this.unformatSymbol(pos.contract),
            contract: pos.contract,
            side: size > 0 ? 'Buy' : 'Sell',
            size: Math.abs(size),
            entryPrice: parseFloat(pos.entry_price || '0'),
            markPrice: parseFloat(pos.mark_price || '0'),
            unrealisedPnl: parseFloat(pos.unrealised_pnl || '0'),
            leverage: parseFloat(pos.leverage || '1'),
            mode: pos.mode || 'single'
          };
        });
    } catch (error) {
      logger.error(`[GATEIO] Error getting positions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Перевіряє чи є відкрита позиція
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
