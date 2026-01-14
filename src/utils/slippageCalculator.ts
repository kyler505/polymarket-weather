import { ENV } from '../config/env';
import { MarketCondition } from './marketAnalysis';

/**
 * Get base slippage tolerance based on market volatility
 */
export const getBaseSlippageTolerance = (marketCondition: MarketCondition): number => {
    if (marketCondition.volatility === 'high') {
        return ENV.MAX_SLIPPAGE_PERCENT_HIGH_VOLATILITY;
    }
    return ENV.MAX_SLIPPAGE_PERCENT_LOW_VOLATILITY;
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
    // Wide spread indicates volatile/illiquid market
    if (marketCondition.spread > 20) {
        finalSlippage *= 1.5; // +50% for very wide spreads
    } else if (marketCondition.spread > 10) {
        finalSlippage *= 1.25; // +25% for wide spreads
    }

    // Apply liquidity multiplier
    // Low depth means orders easily move the market
    if (marketCondition.depth < 50) {
        finalSlippage *= 1.4; // +40% for very thin markets
    } else if (marketCondition.depth < 100) {
        finalSlippage *= 1.2; // +20% for thin markets
    }

    // Cap at maximum (25% seems reasonable for prediction markets)
    const maxSlippage = 25;
    if (finalSlippage > maxSlippage) {
        finalSlippage = maxSlippage;
    }

    return finalSlippage;
};

/**
 * Calculate maximum acceptable price based on slippage tolerance
 */
export const calculateMaxAcceptablePrice = (
    traderPrice: number,
    slippagePercent: number
): number => {
    const slippageMultiplier = 1 + slippagePercent / 100;
    return traderPrice * slippageMultiplier;
};

/**
 * Check if current price is within slippage tolerance
 */
export const isPriceAcceptable = (
    currentPrice: number,
    traderPrice: number,
    slippagePercent: number
): boolean => {
    const maxPrice = calculateMaxAcceptablePrice(traderPrice, slippagePercent);
    return currentPrice <= maxPrice;
};

export default {
    getBaseSlippageTolerance,
    calculateDynamicSlippage,
    calculateMaxAcceptablePrice,
    isPriceAcceptable,
};
