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
    return symbol.replace('USDT', '_USDT');
  }

  /**
   * Конвертує символ назад з формату BTC_USDT в BTCUSDT
   */
  unformatSymbol(symbol) {
    if (!symbol) return '';
    return symbol.replace('_USDT', 'USDT');
  }

  /**
   * Перевіряє з'єднання з API
   */
  async connect() {
    try {
      logger.info('[GATEIO] Connecting to Gate.io API...');
      
      this.initializeClient();
      
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
      if (error.response && error.response.body) {
        logger.error(`[GATEIO] Response: ${JSON.stringify(error.response.body)}`);
      }
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
      
      if (config.gateio.positionMode === 'dual_mode') {
        await this.client.updatePositionLeverage('usdt', contract, leverage.toString(), { mode: 'long' });
        await this.client.updatePositionLeverage('usdt', contract, leverage.toString(), { mode: 'short' });
      } else {
        await this.client.updatePositionLeverage('usdt', contract, leverage.toString());
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
      this.initializeClient();
      
      logger.info(`[GATEIO] Opening ${side} market order: ${quantity} ${symbol}...`);
      
      const contract = this.formatSymbol(symbol);
      const size = side === 'Buy' ? Math.abs(quantity) : -Math.abs(quantity);
      
      const futuresOrder = new GateApi.FuturesOrder();
      futuresOrder.contract = contract;
      futuresOrder.size = size;
      futuresOrder.price = '0';
      futuresOrder.tif = 'ioc';
      futuresOrder.text = `t-${Date.now()}`;
      
      const response = await this.client.createFuturesOrder('usdt', futuresOrder);
      
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
   * Встановлює Take Profit через Limit ордер
   */
  async setTakeProfitLimit(symbol, side, price, quantity, direction) {
    try {
      this.initializeClient();
      
      logger.info(`[GATEIO] Setting Take Profit limit order @ ${price} for ${symbol}...`);
      
      const contract = this.formatSymbol(symbol);
      const closeSize = direction === 'LONG' ? -Math.abs(quantity) : Math.abs(quantity);
      
      const futuresOrder = new GateApi.FuturesOrder();
      futuresOrder.contract = contract;
      futuresOrder.size = closeSize;
      futuresOrder.price = price.toString();
      futuresOrder.tif = 'gtc';
      futuresOrder.reduce_only = true;
      futuresOrder.text = `tp-${Date.now()}`;
      
      const response = await this.client.createFuturesOrder('usdt', futuresOrder);
      
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
   * Встановлює Stop Loss через Price-Triggered ордер
   */
  async setStopLossLimit(symbol, side, price, quantity, direction) {
    try {
      this.initializeClient();
      
      logger.info(`[GATEIO] Setting Stop Loss price-triggered order @ ${price} for ${symbol}...`);
      
      const contract = this.formatSymbol(symbol);
      const closeSize = direction === 'LONG' ? -Math.abs(quantity) : Math.abs(quantity);
      
      const priceOrder = new GateApi.FuturesPriceTriggeredOrder();
      priceOrder.initial = new GateApi.FuturesInitialOrder();
      priceOrder.initial.contract = contract;
      priceOrder.initial.size = closeSize;
      priceOrder.initial.price = price.toString();
      priceOrder.initial.tif = 'gtc';
      priceOrder.initial.reduce_only = true;
      priceOrder.initial.text = `sl-${Date.now()}`;
      
      priceOrder.trigger = new GateApi.FuturesPriceTrigger();
      priceOrder.trigger.strategy_type = 0;
      priceOrder.trigger.price_type = 1;
      priceOrder.trigger.price = price.toString();
      priceOrder.trigger.rule = direction === 'LONG' ? 2 : 1;
      
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
      
      const opts = {};
      if (symbol) {
        opts.contract = this.formatSymbol(symbol);
      }
      
      const response = await this.client.listPositions('usdt', opts);
      
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
}

const gateioService = new GateIOService();
export default gateioService;
