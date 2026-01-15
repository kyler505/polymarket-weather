import { ENV } from '../config/env';
import { MarketCondition } from './marketAnalysis';

/**
 * Get base slippage tolerance
 */
export const getBaseSlippageTolerance = (marketCondition?: MarketCondition): number => {
    // Use a single slippage tolerance for weather trading
    return ENV.MAX_SLIPPAGE_PERCENT;
};

/**
 * Calculate dynamic slippage tolerance based on market conditions
 * Applies multipliers for wide spreads and low liquidity
 */
export const calculateDynamicSlippage = (
    baseSlippage: number,
    marketCondition: MarketCondition
): number => {
    let finalSlippage = baseSlippage;

    // Apply spread multiplier
    if (marketCondition.spread > 20) {
        finalSlippage *= 1.5;
    } else if (marketCondition.spread > 10) {
        finalSlippage *= 1.25;
    }

    // Apply liquidity multiplier
    if (marketCondition.depth < 50) {
        finalSlippage *= 1.4;
    } else if (marketCondition.depth < 100) {
        finalSlippage *= 1.2;
    }

    // Cap at 25%
    return Math.min(finalSlippage, 25);
};

/**
 * Calculate maximum acceptable price based on slippage tolerance
 */
export const calculateMaxAcceptablePrice = (
    traderPrice: number,
    slippagePercent: number
): number => {
    return traderPrice * (1 + slippagePercent / 100);
};

/**
 * Check if current price is within slippage tolerance
 */
export const isPriceAcceptable = (
    currentPrice: number,
    targetPrice: number,
    slippagePercent: number
): boolean => {
    const maxPrice = calculateMaxAcceptablePrice(targetPrice, slippagePercent);
    return currentPrice <= maxPrice;
};

export default {
    getBaseSlippageTolerance,
    calculateDynamicSlippage,
    calculateMaxAcceptablePrice,
    isPriceAcceptable,
};
