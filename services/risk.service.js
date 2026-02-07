import { config } from '../config/settings.js';
import { roundPrice, isValidNumber } from '../utils/helpers.js';
import logger from '../utils/logger.js';

/**
 * Розраховує параметри позиції для Gate.io Futures
 * 
 * ВАЖЛИВО: Gate.io підтримує дробові контракти через header X-Gate-Size-Decimal: 1
 * Це означає що size може бути будь-яким числом, наприклад 0.3 контракту
 * 
 * @param {number} balance - available balance USDT на Futures акаунті
 * @param {number} entryPrice - поточна ціна входу
 * @param {string} direction - 'LONG' або 'SHORT'
 * @param {Object} symbolInfo - інформація про символ (minQty, maxQty, pricePrecision)
 * @returns {Object} параметри позиції
 */
export function calculatePositionParameters(balance, entryPrice, direction, symbolInfo = {}) {
  try {
    // Валідація вхідних даних
    if (!isValidNumber(balance) || balance <= 0) {
      throw new Error(`Invalid balance: ${balance}`);
    }
    
    if (!isValidNumber(entryPrice) || entryPrice <= 0) {
      throw new Error(`Invalid entry price: ${entryPrice}`);
    }
    
    if (direction !== 'LONG' && direction !== 'SHORT') {
      throw new Error(`Invalid direction: ${direction}. Must be LONG or SHORT`);
    }

    const leverage = config.risk.leverage;
    const riskPercent = config.risk.percentage / 100; // Конвертуємо в decimal (3% → 0.03)
    
    // КРОК 1: Safety buffer (99%)
    const usableBalance = balance * 0.99;
    
    // КРОК 2: marginLimit = usableBalance * riskPercent
    // Це МАКСИМАЛЬНА маржа яку ми хочемо використати
    const marginLimit = usableBalance * riskPercent;
    
    // КРОК 3: notional = marginLimit * leverage
    // Це розмір позиції в USDT
    const notional = marginLimit * leverage;
    
    // КРОК 4: size (кількість контрактів) = notional / entryPrice
    // Gate.io підтримує дробові контракти через X-Gate-Size-Decimal: 1 header
    // Тому НЕ використовуємо Math.floor() - дозволяємо дробові значення
    // Приклад: для HYPE ($33.29) з ризиком 3%:
    // - notional = 7.2 USDT
    // - size = 7.2 / 33.29 = 0.216 контрактів ✅ (дозволено!)
    let size = notional / entryPrice;
    
    // КРОК 5: Округлення до розумної точності (6 знаків після коми)
    // Це для уникнення проблем з float precision
    size = Math.round(size * 1000000) / 1000000;
    
    // КРОК 6: Перевірка максимуму (якщо заданий)
    const maxQty = symbolInfo.maxQty || Infinity;
    if (size > maxQty) {
      logger.warn(`[RISK] Calculated size (${size}) > maximum (${maxQty}). Using maximum.`);
      size = maxQty;
    }
    
    // КРОК 7: Перерахувати фактичну маржу з фінальним size
    let requiredMargin = (size * entryPrice) / leverage;
    
    // КРОК 8: Фінальна перевірка балансу
    if (requiredMargin > usableBalance) {
      throw new Error(
        `Insufficient balance. ` +
        `Required: ${requiredMargin.toFixed(6)} USDT, ` +
        `Usable: ${usableBalance.toFixed(6)} USDT (99% of ${balance.toFixed(2)} USDT)`
      );
    }
    
    // КРОК 9: Розрахувати TP/SL ціни
    const stopLossPrice = direction === 'LONG'
      ? entryPrice * (1 - config.risk.stopLossPercent / 100)
      : entryPrice * (1 + config.risk.stopLossPercent / 100);
    
    const takeProfitPrice = direction === 'LONG'
      ? entryPrice * (1 + config.risk.takeProfitPercent / 100)
      : entryPrice * (1 - config.risk.takeProfitPercent / 100);
    
    // КРОК 10: Округлити ціни
    const pricePrecision = symbolInfo.pricePrecision !== undefined ? symbolInfo.pricePrecision : 4;
    const roundedEntryPrice = roundPrice(entryPrice, pricePrecision);
    const roundedStopLoss = roundPrice(stopLossPrice, pricePrecision);
    const roundedTakeProfit = roundPrice(takeProfitPrice, pricePrecision);
    
    // Фінальний notional з реальним size
    const finalNotional = size * entryPrice;
    
    // Debug лог перед відкриттям
    logger.info(`[RISK] ━━━ POSITION CALCULATION ━━━`);
    logger.info(`  Symbol: ${symbolInfo.symbol || 'UNKNOWN'}`);
    logger.info(`  Entry Price: $${entryPrice}`);
    logger.info(`  Available Balance: ${balance.toFixed(6)} USDT`);
    logger.info(`  Usable Balance (99%): ${usableBalance.toFixed(6)} USDT`);
    logger.info(`  Risk Percent: ${(riskPercent * 100).toFixed(2)}%`);
    logger.info(`  Margin Limit: ${marginLimit.toFixed(6)} USDT`);
    logger.info(`  Leverage: ${leverage}x`);
    logger.info(`  Notional (target): ${notional.toFixed(6)} USDT`);
    logger.info(`  Size: ${size} contracts (fractional allowed)`);
    logger.info(`  Notional (actual): ${finalNotional.toFixed(6)} USDT`);
    logger.info(`  Required Margin: ${requiredMargin.toFixed(6)} USDT`);
    logger.info(`  Margin %: ${((requiredMargin/balance)*100).toFixed(2)}%`);
    logger.info(`  TP: ${roundedTakeProfit}, SL: ${roundedStopLoss}`);
    
    const result = {
      entryPrice: roundedEntryPrice,
      quantity: size,  // FLOAT з дробовою частиною (наприклад 0.216)
      positionSize: finalNotional,
      leverage: leverage,
      requiredMargin: requiredMargin,
      stopLoss: roundedStopLoss,
      takeProfit: roundedTakeProfit,
      riskAmount: marginLimit,
      direction: direction,
      symbol: symbolInfo.symbol || 'UNKNOWN'
    };

    return result;
  } catch (error) {
    logger.error(`[RISK] Error calculating position parameters: ${error.message}`);
    throw error;
  }
}

/**
 * Перевіряє чи достатньо балансу для відкриття позиції
 */
export function hasSufficientBalance(balance, requiredMargin) {
  return isValidNumber(balance) && isValidNumber(requiredMargin) && balance >= requiredMargin;
}

export default {
  calculatePositionParameters,
  hasSufficientBalance
};
