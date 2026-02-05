import GateApi from 'gate-api';
import { config } from '../config/settings.js';
import logger from '../utils/logger.js';

class GateIOService {
  constructor() {
    this.client = null;
    this.apiClient = null;
    this.isConnected = false;
  }

  /**
   * Ініціалізує клієнт Gate.io API
   */
  initializeClient() {
    if (!this.client) {
      this.apiClient = new GateApi.ApiClient();
      this.apiClient.basePath = config.gateio.baseURL;
      this.apiClient.setApiKeySecret(config.gateio.apiKey, config.gateio.apiSecret);
      
      this.client = new GateApi.FuturesApi(this.apiClient);
    }
  }

  /**
   * Конвертує символ з формату BTCUSDT в BTC_USDT
   */
  formatSymbol(symbol) {
    if (!symbol) return '';
    // BTCUSDT -> BTC_USDT
    return symbol.replace('USDT', '_USDT');
  }

  /**
   * Конвертує символ назад з формату BTC_USDT в BTCUSDT
   */
  unformatSymbol(symbol) {
    if (!symbol) return '';
    // BTC_USDT -> BTCUSDT
    return symbol.replace('_USDT', 'USDT');
  }

  /**
   * Визначає position mode (long/short) для dual_mode
   */
  getPositionMode(direction) {
    if (config.gateio.positionMode === 'dual_mode') {
      return direction === 'LONG' ? 'long' : 'short';
    }
    return undefined; // single_mode не потребує цього параметра
  }

  /**
   * Перевіряє з'єднання з API
   */
  async connect() {
    try {
      logger.info('[GATEIO] Connecting to Gate.io API...');
      
      this.initializeClient();
      
      // Перевіряємо підключення через запит балансу
      const response = await this.client.listFuturesAccounts('usdt');
      
      if (response && response.body) {
        this.isConnected = true;
        logger.info(`[GATEIO] ✅ Connected to Gate.io MAINNET`);
        logger.info(`[GATEIO] Position mode: ${config.gateio.positionMode}`);
        return true;
      } else {
        throw new Error('Invalid API response');
      }
    } catch (error) {
      logger.error(`[GATEIO] Connection failed: ${error.message}`);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Отримує баланс USDT на Futures акаунті
   */
  async getUSDTBalance() {
    try {
      this.initializeClient();
      
      const response = await this.client.listFuturesAccounts('usdt');
      
      if (!response || !response.body) {
        throw new Error('Failed to get balance: Invalid response');
      }

      const account = response.body;
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
      this.initializeClient();
      
      const contract = this.formatSymbol(symbol);
      const response = await this.client.getFuturesContract('usdt', contract);
      
      if (!response || !response.body) {
        throw new Error(`Contract ${contract} not found`);
      }

      const contractInfo = response.body;
      
      // Визначаємо precision з order_size_min
      const orderSizeMin = parseFloat(contractInfo.order_size_min || '1');
      let tickSize = orderSizeMin;
      
      // Визначаємо price precision
      const orderPriceRound = parseFloat(contractInfo.order_price_round || '0.01');
      const pricePrecision = Math.abs(Math.floor(Math.log10(orderPriceRound)));

      return {
        symbol: this.unformatSymbol(contractInfo.name),
        contract: contractInfo.name,
        tickSize: tickSize,
        minQty: parseFloat(contractInfo.order_size_min || '1'),
        maxQty: parseFloat(contractInfo.order_size_max || '1000000'),
        pricePrecision: pricePrecision,
        status: contractInfo.in_delisting ? 'Delisting' : 'Trading',
        leverage: contractInfo.leverage_max || '100'
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
      this.initializeClient();
      
      const contract = this.formatSymbol(symbol);
      const response = await this.client.listFuturesTickers('usdt', { contract });
      
      if (!response || !response.body || response.body.length === 0) {
        throw new Error(`Ticker for ${contract} not found`);
      }

      const ticker = response.body[0];
      const lastPrice = parseFloat(ticker.last);
      
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
      this.initializeClient();
      
      logger.info(`[GATEIO] Setting leverage ${leverage}x for ${symbol}...`);
      
      const contract = this.formatSymbol(symbol);
      
      // Gate.io потребує окремих викликів для long і short в dual_mode
      if (config.gateio.positionMode === 'dual_mode') {
        // Встановлюємо для LONG
        await this.client.updatePositionLeverage('usdt', contract, leverage.toString(), { mode: 'long' });
        // Встановлюємо для SHORT
        await this.client.updatePositionLeverage('usdt', contract, leverage.toString(), { mode: 'short' });
      } else {
        // single_mode
        await this.client.updatePositionLeverage('usdt', contract, leverage.toString());
      }
      
      logger.info(`[GATEIO] ✅ Leverage ${leverage}x set for ${symbol}`);
      return true;
    } catch (error) {
      // Якщо плече вже встановлене - це OK
      if (error.message?.includes('leverage not modified') || 
          error.message?.includes('same leverage')) {
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
      this.initializeClient();
      
      logger.info(`[GATEIO] Opening ${side} market order: ${quantity} ${symbol}...`);
      
      const contract = this.formatSymbol(symbol);
      
      // Визначаємо size (додатне для Buy, від'ємне для Sell)
      const size = side === 'Buy' ? Math.abs(quantity) : -Math.abs(quantity);
      
      const order = new GateApi.FuturesOrder();
      order.contract = contract;
      order.size = size;
      order.price = '0'; // '0' означає market price
      order.tif = 'ioc'; // immediate-or-cancel
      
      // Додаємо text для ідентифікації
      order.text = `t-${Date.now()}`;
      
      // Для dual_mode вказуємо режим
      if (config.gateio.positionMode === 'dual_mode' && direction) {
        order.auto_size = direction === 'LONG' ? 'close_short' : 'close_long';
      }
      
      const response = await this.client.createFuturesOrder('usdt', order);
      
      if (!response || !response.body) {
        throw new Error('Failed to open order: Invalid response');
      }

      const orderId = response.body.id?.toString() || '';
      logger.info(`[GATEIO] ✅ Market order opened: Order ID ${orderId}`);
      
      return {
        orderId: orderId,
        orderLinkId: response.body.text,
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
   * Встановлює Take Profit через Limit ордер (0.02% комісія)
   */
  async setTakeProfitLimit(symbol, side, price, quantity, direction) {
    try {
      this.initializeClient();
      
      logger.info(`[GATEIO] Setting Take Profit limit order @ ${price} for ${symbol}...`);
      
      const contract = this.formatSymbol(symbol);
      
      // Визначаємо розмір для закриття позиції
      // Для LONG позиції - продаємо (негативний size)
      // Для SHORT позиції - купуємо (позитивний size)
      const closeSize = direction === 'LONG' ? -Math.abs(quantity) : Math.abs(quantity);
      
      const order = new GateApi.FuturesOrder();
      order.contract = contract;
      order.size = closeSize;
      order.price = price.toString();
      order.tif = 'gtc'; // good-til-cancelled
      order.reduce_only = true; // ОБОВ'ЯЗКОВО для TP/SL
      order.text = `tp-${Date.now()}`;
      
      // Для dual_mode вказуємо що закриваємо
      if (config.gateio.positionMode === 'dual_mode') {
        order.auto_size = direction === 'LONG' ? 'close_long' : 'close_short';
      }
      
      const response = await this.client.createFuturesOrder('usdt', order);
      
      if (!response || !response.body) {
        throw new Error('Failed to set Take Profit: Invalid response');
      }

      const orderId = response.body.id?.toString() || 'TP_LIMIT';
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
   * Встановлює Stop Loss через Price-Triggered ордер (0.02% комісія при виконанні як limit)
   */
  async setStopLossLimit(symbol, side, price, quantity, direction) {
    try {
      this.initializeClient();
      
      logger.info(`[GATEIO] Setting Stop Loss price-triggered order @ ${price} for ${symbol}...`);
      
      const contract = this.formatSymbol(symbol);
      
      // Визначаємо trigger price та order price
      const triggerPrice = price;
      
      // Для LONG: тригер нижче входу, виконуємо продаж
      // Для SHORT: тригер вище входу, виконуємо покупку
      const closeSize = direction === 'LONG' ? -Math.abs(quantity) : Math.abs(quantity);
      
      // Використовуємо price-triggered orders API
      const priceOrder = new GateApi.FuturesPriceTriggeredOrder();
      priceOrder.initial = new GateApi.FuturesInitialOrder();
      priceOrder.initial.contract = contract;
      priceOrder.initial.size = closeSize;
      priceOrder.initial.price = price.toString(); // Limit price при виконанні
      priceOrder.initial.tif = 'gtc';
      priceOrder.initial.reduce_only = true;
      priceOrder.initial.text = `sl-${Date.now()}`;
      
      // Trigger налаштування
      priceOrder.trigger = new GateApi.FuturesPriceTrigger();
      priceOrder.trigger.strategy_type = 0; // 0 = price trigger
      priceOrder.trigger.price_type = 1; // 1 = mark price (краще для SL)
      priceOrder.trigger.price = triggerPrice.toString();
      priceOrder.trigger.rule = direction === 'LONG' ? 2 : 1; // 1 = >=, 2 = <=
      
      // Для dual_mode
      if (config.gateio.positionMode === 'dual_mode') {
        priceOrder.initial.auto_size = direction === 'LONG' ? 'close_long' : 'close_short';
      }
      
      const response = await this.client.createPriceTriggeredOrder('usdt', priceOrder);
      
      if (!response || !response.body) {
        throw new Error('Failed to set Stop Loss: Invalid response');
      }

      const orderId = response.body.id?.toString() || 'SL_TRIGGERED';
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
      this.initializeClient();
      
      const params = {};
      if (symbol) {
        params.contract = this.formatSymbol(symbol);
      }
      
      const response = await this.client.listPositions('usdt', params);
      
      if (!response || !response.body) {
        throw new Error('Failed to get positions: Invalid response');
      }

      const positions = response.body
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

      return positions;
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
      this.initializeClient();
      
      const opts = { limit: limit };
      
      if (symbol) {
        opts.contract = this.formatSymbol(symbol);
      }

      const response = await this.client.listMyTrades('usdt', opts);

      if (!response || !response.body) {
        throw new Error('Failed to get trade history: Invalid response');
      }

      return response.body.map(trade => ({
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

  /**
   * Скасовує ордер
   */
  async cancelOrder(orderId, symbol) {
    try {
      this.initializeClient();
      
      logger.info(`[GATEIO] Cancelling order ${orderId} for ${symbol}...`);
      
      await this.client.cancelFuturesOrder('usdt', orderId);
      
      logger.info(`[GATEIO] ✅ Order ${orderId} cancelled`);
      return true;
    } catch (error) {
      logger.error(`[GATEIO] Error cancelling order: ${error.message}`);
      throw error;
    }
  }

  /**
   * Скасовує price-triggered ордер (для SL)
   */
  async cancelPriceTriggeredOrder(orderId) {
    try {
      this.initializeClient();
      
      logger.info(`[GATEIO] Cancelling price-triggered order ${orderId}...`);
      
      await this.client.cancelPriceTriggeredOrder('usdt', orderId);
      
      logger.info(`[GATEIO] ✅ Price-triggered order ${orderId} cancelled`);
      return true;
    } catch (error) {
      logger.error(`[GATEIO] Error cancelling price-triggered order: ${error.message}`);
      throw error;
    }
  }
}

// Експортуємо singleton
const gateioService = new GateIOService();
export default gateioService;
