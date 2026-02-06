import { config } from '../config/settings.js';
import { roundPrice, isValidNumber } from '../utils/helpers.js';
import logger from '../utils/logger.js';

/**
 * Розраховує параметри позиції для Gate.io Futures згідно правильної логіки
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
    const riskPercent = config.risk.percentage / 100; // Конвертуємо в decimal (10% → 0.10)
    
    // КРОК 1: Safety buffer (99%)
    const usableBalance = balance * 0.99;
    
    // КРОК 2: marginLimit = usableBalance * riskPercent
    // Це МАКСИМАЛЬНА маржа яку ми хочемо використати
    const marginLimit = usableBalance * riskPercent;
    
    // КРОК 3: notional = marginLimit * leverage
    // Це розмір позиції в USDT
    const notional = marginLimit * leverage;
    
    // КРОК 4: size (кількість контрактів) = floor(notional / entryPrice)
    // Gate.io: 1 contract = 1 USD worth of asset
    // Для USDT-settled futures: size = notional / entry_price
    let size = Math.floor(notional / entryPrice);
    
    // КРОК 5: Перевірка мінімальних обмежень
    const minQty = Math.max(symbolInfo.minQty || 1, 1);
    const maxQty = symbolInfo.maxQty || Infinity;
    
    if (size < minQty) {
      throw new Error(
        `Insufficient balance for minimum order size. ` +
        `Calculated: ${size} contracts, Minimum: ${minQty} contracts`
      );
    }
    
    if (size > maxQty) {
      logger.warn(`[RISK] Calculated size (${size}) > maximum (${maxQty}). Using maximum.`);
      size = maxQty;
    }
    
    // КРОК 6: Перерахувати фактичну маржу з фінальним size
    let requiredMargin = (size * entryPrice) / leverage;
    
    // КРОК 7: Автокорекція якщо requiredMargin > usableBalance
    while (requiredMargin > usableBalance && size > minQty) {
      logger.warn(`[RISK] Margin ${requiredMargin.toFixed(6)} > usable ${usableBalance.toFixed(6)}, reducing size: ${size} -> ${size - 1}`);
      size -= 1;
      requiredMargin = (size * entryPrice) / leverage;
    }
    
    // Фінальна перевірка
    if (requiredMargin > usableBalance) {
      throw new Error(
        `Insufficient balance even with adjusted size. ` +
        `Required: ${requiredMargin.toFixed(6)} USDT, ` +
        `Usable: ${usableBalance.toFixed(6)} USDT (99% of ${balance})`
      );
    }
    
    // КРОК 8: Розрахувати TP/SL ціни
    const stopLossPrice = direction === 'LONG'
      ? entryPrice * (1 - config.risk.stopLossPercent / 100)
      : entryPrice * (1 + config.risk.stopLossPercent / 100);
    
    const takeProfitPrice = direction === 'LONG'
      ? entryPrice * (1 + config.risk.takeProfitPercent / 100)
      : entryPrice * (1 - config.risk.takeProfitPercent / 100);
    
    // КРОК 9: Округлити ціни
    const pricePrecision = symbolInfo.pricePrecision !== undefined ? symbolInfo.pricePrecision : 4;
    const roundedEntryPrice = roundPrice(entryPrice, pricePrecision);
    const roundedStopLoss = roundPrice(stopLossPrice, pricePrecision);
    const roundedTakeProfit = roundPrice(takeProfitPrice, pricePrecision);
    
    // Фінальний notional з реальним size
    const finalNotional = size * entryPrice;
    
    // Debug лог перед відкриттям
    logger.info(`[RISK] ━━━ POSITION CALCULATION ━━━`);
    logger.info(`  Available Balance: ${balance.toFixed(6)} USDT`);
    logger.info(`  Usable Balance (99%): ${usableBalance.toFixed(6)} USDT`);
    logger.info(`  Risk Percent: ${(riskPercent * 100).toFixed(2)}%`);
    logger.info(`  Margin Limit: ${marginLimit.toFixed(6)} USDT`);
    logger.info(`  Leverage: ${leverage}x`);
    logger.info(`  Notional (target): ${notional.toFixed(6)} USDT`);
    logger.info(`  Entry Price: ${entryPrice}`);
    logger.info(`  Size: ${size} contracts`);
    logger.info(`  Notional (actual): ${finalNotional.toFixed(6)} USDT`);
    logger.info(`  Required Margin: ${requiredMargin.toFixed(6)} USDT`);
    logger.info(`  Margin %: ${((requiredMargin/balance)*100).toFixed(2)}%`);
    logger.info(`  TP: ${roundedTakeProfit}, SL: ${roundedStopLoss}`);
    
    const result = {
      entryPrice: roundedEntryPrice,
      quantity: size,  // INTEGER (кількість контрактів)
      positionSize: finalNotional,
      leverage: leverage,
      requiredMargin: requiredMargin,
      stopLoss: roundedStopLoss,
      takeProfit: roundedTakeProfit,
      riskAmount: marginLimit, // Це наш marginLimit
      direction: direction
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
