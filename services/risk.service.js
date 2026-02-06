import { config } from '../config/settings.js';
import { roundQuantity, roundPrice, isValidNumber } from '../utils/helpers.js';
import logger from '../utils/logger.js';

/**
 * Розраховує параметри позиції на основі risk management правил
 * @param {number} balance - баланс USDT на Futures акаунті
 * @param {number} entryPrice - поточна ціна входу
 * @param {string} direction - 'LONG' або 'SHORT'
 * @param {Object} symbolInfo - інформація про символ (tickSize, minQty, maxQty, pricePrecision)
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

    // 🔹 SAFETY BUFFER: Використовуємо 99% балансу для розрахунків
    const usableBalance = balance * 0.99;
    logger.info(`[RISK] Balance: ${balance} USDT, Usable (99%): ${usableBalance.toFixed(6)} USDT`);

    // 1. Розрахувати ризик в USDT (від usableBalance)
    const riskAmount = usableBalance * (config.risk.percentage / 100);
    logger.info(`[RISK] Risk: ${config.risk.percentage}% = ${riskAmount.toFixed(6)} USDT`);

    // 2. Розрахувати Stop Loss ціну
    const stopLossPrice = direction === 'LONG'
      ? entryPrice * (1 - config.risk.stopLossPercent / 100)  // -0.3%
      : entryPrice * (1 + config.risk.stopLossPercent / 100); // +0.3%

    // 3. Розрахувати відстань до SL
    const stopLossDistance = Math.abs(entryPrice - stopLossPrice);
    
    if (stopLossDistance <= 0) {
      throw new Error('Stop loss distance is zero or negative');
    }

    // 4. Розрахувати розмір позиції (в USDT)
    let positionSize = (riskAmount / stopLossDistance) * entryPrice;

    // 5. З урахуванням плеча
    const leverage = config.risk.leverage;
    let requiredMargin = positionSize / leverage;

    // 🔹 ПЕРЕВІРКА: якщо margin перевищує usableBalance
    if (requiredMargin > usableBalance) {
      logger.warn(`[RISK] Required margin (${requiredMargin.toFixed(6)}) > usable balance (${usableBalance.toFixed(6)})`);
      // Перерахувати з максимально доступним балансом
      positionSize = usableBalance * leverage;
      requiredMargin = usableBalance;
    }

    // 6. Розрахувати кількість контрактів
    let quantity = positionSize / entryPrice;

    // 7. Розрахувати Take Profit ціну
    const takeProfitPrice = direction === 'LONG'
      ? entryPrice * (1 + config.risk.takeProfitPercent / 100)  // +0.5%
      : entryPrice * (1 - config.risk.takeProfitPercent / 100); // -0.5%

    // 8. Округлити значення згідно з вимогами біржі
    const pricePrecision = symbolInfo.pricePrecision !== undefined ? symbolInfo.pricePrecision : 4;
    
    // 🔹 ВАЖЛИВО: Gate.io futures - size тільки INTEGER (enable_decimal=false)
    const minQty = Math.max(symbolInfo.minQty || 1, 1); // Мінімум 1 контракт
    const maxQty = symbolInfo.maxQty || Infinity;

    // Округлюємо quantity до INTEGER (вниз)
    quantity = Math.floor(quantity);

    const roundedEntryPrice = roundPrice(entryPrice, pricePrecision);
    const roundedStopLoss = roundPrice(stopLossPrice, pricePrecision);
    const roundedTakeProfit = roundPrice(takeProfitPrice, pricePrecision);

    // Перевірка мінімальних обмежень
    if (quantity < minQty) {
      logger.warn(`[RISK] Calculated quantity (${quantity}) < minimum (${minQty}). Using minimum.`);
      quantity = minQty;
    }

    // Перевірка максимальних обмежень
    if (quantity > maxQty) {
      logger.warn(`[RISK] Calculated quantity (${quantity}) > maximum (${maxQty}). Using maximum.`);
      quantity = maxQty;
    }

    // 🔹 АВТОКОРЕКЦІЯ: якщо requiredMargin > usableBalance, зменшуємо size по 1 контракту
    let finalRequiredMargin = (quantity * entryPrice) / leverage;
    
    while (finalRequiredMargin > usableBalance && quantity > minQty) {
      logger.warn(`[RISK] Margin ${finalRequiredMargin.toFixed(6)} > usable ${usableBalance.toFixed(6)}, reducing size: ${quantity} -> ${quantity - 1}`);
      quantity -= 1;
      finalRequiredMargin = (quantity * entryPrice) / leverage;
    }

    // 🔹 ФІНАЛЬНА ПЕРЕВІРКА: дозволяємо мікро-різницю до 0.1 USDT
    const marginDifference = finalRequiredMargin - usableBalance;
    
    if (marginDifference > 0.1) {
      // Якщо різниця > 0.1 USDT і size вже мінімальний
      if (quantity <= minQty) {
        throw new Error(
          `Insufficient balance even with minimum size. ` +
          `Required: ${finalRequiredMargin.toFixed(6)} USDT, ` +
          `Usable: ${usableBalance.toFixed(6)} USDT (99% of ${balance}), ` +
          `Difference: ${marginDifference.toFixed(6)} USDT`
        );
      }
    } else if (marginDifference > 0 && marginDifference <= 0.1) {
      // Мікро-різниця < 0.1 USDT - зменшуємо size на 1 для безпеки
      logger.info(`[RISK] Micro-difference ${marginDifference.toFixed(6)} USDT detected, reducing size for safety`);
      if (quantity > minQty) {
        quantity -= 1;
        finalRequiredMargin = (quantity * entryPrice) / leverage;
      }
    }

    // Перерахувати positionSize з фінальним quantity
    const finalPositionSize = quantity * entryPrice;

    const result = {
      entryPrice: roundedEntryPrice,
      quantity: quantity,  // INTEGER
      positionSize: finalPositionSize,
      leverage: leverage,
      requiredMargin: finalRequiredMargin,
      stopLoss: roundedStopLoss,
      takeProfit: roundedTakeProfit,
      riskAmount: riskAmount,
      direction: direction
    };

    logger.info(
      `[RISK] ✅ Final position: ${quantity} contracts @ ${roundedEntryPrice}, ` +
      `Margin: ${finalRequiredMargin.toFixed(6)} USDT (${((finalRequiredMargin/balance)*100).toFixed(2)}%), ` +
      `TP: ${roundedTakeProfit}, SL: ${roundedStopLoss}`
    );

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
