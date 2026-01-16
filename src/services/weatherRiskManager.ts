/**
 * Weather Risk Manager
 * Manages exposure limits and kill-switches for weather trading
 */

import { WeatherMarket, WeatherTradeSignal } from '../interfaces/WeatherMarket';
import { ENV } from '../config/env';
import Logger from '../utils/logger';

interface ExposureTracker {
    perMarket: Map<string, number>;      // conditionId -> USD exposure
    perRegion: Map<string, number>;      // region -> USD exposure
    perDate: Map<string, number>;        // targetDate -> USD exposure
    dailyPnL: number;                     // Running REALIZED P&L for the day
    lastPnLReset: Date;                   // When daily P&L was last reset
    lastDataUpdate: Date;                 // When we last got fresh data
    isPaused: boolean;                    // Kill-switch flag
    pauseReason: string | null;
}

// Track open positions for mark-to-market calculations
interface OpenPosition {
    conditionId: string;
    tokenId: string;
    entryPrice: number;
    shares: number;
    costBasis: number;
}

const openPositions: Map<string, OpenPosition> = new Map(); // tokenId -> position

const exposure: ExposureTracker = {
    perMarket: new Map(),
    perRegion: new Map(),
    perDate: new Map(),
    dailyPnL: 0,
    lastPnLReset: new Date(),
    lastDataUpdate: new Date(),
    isPaused: false,
    pauseReason: null,
};

/**
 * Reset daily P&L at the start of each day
 */
function maybeResetDailyPnL(): void {
    const now = new Date();
    const lastReset = exposure.lastPnLReset;

    // Reset if it's a new day
    if (now.toDateString() !== lastReset.toDateString()) {
        Logger.info(`Resetting daily P&L (previous: $${exposure.dailyPnL.toFixed(2)})`);
        exposure.dailyPnL = 0;
        exposure.lastPnLReset = now;

        // Also resume if paused due to daily loss
        if (exposure.pauseReason === 'Daily loss limit reached') {
            exposure.isPaused = false;
            exposure.pauseReason = null;
            Logger.info('Resuming trading after daily reset');
        }
    }
}

/**
 * Check if a trade is allowed given current exposure limits
 */
export function canTrade(market: WeatherMarket, sizeUSD: number): { allowed: boolean; reason: string } {
    maybeResetDailyPnL();

    // Check if paused
    if (exposure.isPaused) {
        return { allowed: false, reason: `Trading paused: ${exposure.pauseReason}` };
    }

    // Check data freshness
    const dataAge = Date.now() - exposure.lastDataUpdate.getTime();
    if (dataAge > ENV.MAX_DATA_AGE_MS) {
        return { allowed: false, reason: `Data stale (${Math.round(dataAge / 60000)} min old)` };
    }

    // Check per-market exposure
    const currentMarketExposure = exposure.perMarket.get(market.conditionId) || 0;
    if (currentMarketExposure + sizeUSD > ENV.MAX_EXPOSURE_PER_MARKET_USD) {
        return {
            allowed: false,
            reason: `Market exposure limit ($${ENV.MAX_EXPOSURE_PER_MARKET_USD}) would be exceeded`
        };
    }

    // Check per-region exposure
    const currentRegionExposure = exposure.perRegion.get(market.region) || 0;
    if (currentRegionExposure + sizeUSD > ENV.MAX_EXPOSURE_PER_REGION_USD) {
        return {
            allowed: false,
            reason: `Region exposure limit ($${ENV.MAX_EXPOSURE_PER_REGION_USD}) would be exceeded for ${market.region}`
        };
    }

    // Check per-date exposure
    const currentDateExposure = exposure.perDate.get(market.targetDate) || 0;
    if (currentDateExposure + sizeUSD > ENV.MAX_EXPOSURE_PER_DATE_USD) {
        return {
            allowed: false,
            reason: `Date exposure limit ($${ENV.MAX_EXPOSURE_PER_DATE_USD}) would be exceeded for ${market.targetDate}`
        };
    }

    // Check total global exposure
    // Calculate current total
    let currentTotalExposure = 0;
    for (const exp of exposure.perMarket.values()) currentTotalExposure += exp;

    // Default global limit if not in ENV (safe fallback)
    const MAX_TOTAL = process.env.MAX_TOTAL_EXPOSURE_USD ? parseFloat(process.env.MAX_TOTAL_EXPOSURE_USD) : 250.0;

    if (currentTotalExposure + sizeUSD > MAX_TOTAL) {
        return {
            allowed: false,
            reason: `Total exposure limit ($${MAX_TOTAL}) would be exceeded`
        };
    }

    // Check minimum order size
    if (sizeUSD < ENV.MIN_ORDER_SIZE_USD) {
        return { allowed: false, reason: `Size $${sizeUSD.toFixed(2)} below minimum $${ENV.MIN_ORDER_SIZE_USD}` };
    }

    // Check maximum order size
    if (sizeUSD > ENV.MAX_ORDER_SIZE_USD) {
        return { allowed: false, reason: `Size $${sizeUSD.toFixed(2)} above maximum $${ENV.MAX_ORDER_SIZE_USD}` };
    }

    return { allowed: true, reason: 'OK' };
}

/**
 * Record a trade for exposure tracking
 */
export function recordTrade(market: WeatherMarket, sizeUSD: number, side: 'BUY' | 'SELL'): void {
    // For buys, increase exposure; for sells, decrease
    const delta = side === 'BUY' ? sizeUSD : -sizeUSD;

    // Update per-market exposure
    const currentMarket = exposure.perMarket.get(market.conditionId) || 0;
    exposure.perMarket.set(market.conditionId, Math.max(0, currentMarket + delta));

    // Update per-region exposure
    const currentRegion = exposure.perRegion.get(market.region) || 0;
    exposure.perRegion.set(market.region, Math.max(0, currentRegion + delta));

    // Update per-date exposure
    const currentDate = exposure.perDate.get(market.targetDate) || 0;
    exposure.perDate.set(market.targetDate, Math.max(0, currentDate + delta));
}

/**
 * Record P&L for a closed position
 */
export function recordPnL(pnlUSD: number): void {
    maybeResetDailyPnL();
    exposure.dailyPnL += pnlUSD;

    // Check daily loss limit (realized only - see checkDailyStopWithMTM for full check)
    if (exposure.dailyPnL < -ENV.MAX_DAILY_LOSS_USD) {
        exposure.isPaused = true;
        exposure.pauseReason = 'Daily loss limit reached';
        Logger.warning(`🛑 Trading paused: Daily loss $${Math.abs(exposure.dailyPnL).toFixed(2)} exceeds limit $${ENV.MAX_DAILY_LOSS_USD}`);
    }
}

/**
 * Record an open position for MTM tracking
 */
export function recordOpenPosition(
    conditionId: string,
    tokenId: string,
    entryPrice: number,
    shares: number,
    costBasis: number
): void {
    const existing = openPositions.get(tokenId);
    if (existing) {
        // Average into existing position
        const totalShares = existing.shares + shares;
        const totalCost = existing.costBasis + costBasis;
        existing.shares = totalShares;
        existing.costBasis = totalCost;
        existing.entryPrice = totalCost / totalShares;
    } else {
        openPositions.set(tokenId, {
            conditionId,
            tokenId,
            entryPrice,
            shares,
            costBasis
        });
    }
    Logger.debug(`📊 Opened position: ${tokenId} | ${shares.toFixed(2)} shares @ ${entryPrice.toFixed(3)}`);
}

/**
 * Close a position (remove from MTM tracking)
 */
export function closePosition(tokenId: string): OpenPosition | null {
    const position = openPositions.get(tokenId);
    if (position) {
        openPositions.delete(tokenId);
        Logger.debug(`📊 Closed position: ${tokenId}`);
    }
    return position || null;
}

/**
 * Compute unrealized P&L given current market prices
 */
export function computeUnrealizedPnL(currentPrices: Map<string, number>): number {
    let unrealizedPnL = 0;

    for (const [tokenId, position] of openPositions) {
        const currentPrice = currentPrices.get(tokenId);
        if (currentPrice !== undefined) {
            // MTM value = shares * currentPrice
            // Unrealized PnL = MTM value - cost basis
            const mtmValue = position.shares * currentPrice;
            const positionPnL = mtmValue - position.costBasis;
            unrealizedPnL += positionPnL;
        }
        // If no current price, assume neutral (0 unrealized)
    }

    return unrealizedPnL;
}

/**
 * Check daily stop using realized + unrealized P&L
 * Call this periodically with current market prices
 */
export function checkDailyStopWithMTM(currentPrices: Map<string, number>): boolean {
    maybeResetDailyPnL();

    const unrealized = computeUnrealizedPnL(currentPrices);
    const totalPnL = exposure.dailyPnL + unrealized;

    if (totalPnL < -ENV.MAX_DAILY_LOSS_USD && !exposure.isPaused) {
        exposure.isPaused = true;
        exposure.pauseReason = 'Daily loss limit reached (MTM)';
        Logger.warning(`🛑 Trading paused: Daily MTM loss $${Math.abs(totalPnL).toFixed(2)} exceeds limit $${ENV.MAX_DAILY_LOSS_USD}`);
        Logger.warning(`   (Realized: $${exposure.dailyPnL.toFixed(2)}, Unrealized: $${unrealized.toFixed(2)})`);
        return true;
    }

    return false;
}

/**
 * Get open positions summary
 */
export function getOpenPositionsSummary(): { count: number; totalCostBasis: number } {
    let totalCostBasis = 0;
    for (const pos of openPositions.values()) {
        totalCostBasis += pos.costBasis;
    }
    return { count: openPositions.size, totalCostBasis };
}

/**
 * Update last data timestamp (call when fresh data is received)
 */
export function updateDataTimestamp(): void {
    exposure.lastDataUpdate = new Date();
}

/**
 * Pause trading with a reason
 */
export function pauseTrading(reason: string): void {
    exposure.isPaused = true;
    exposure.pauseReason = reason;
    Logger.warning(`🛑 Trading paused: ${reason}`);
}

/**
 * Resume trading
 */
export function resumeTrading(): void {
    exposure.isPaused = false;
    exposure.pauseReason = null;
    Logger.info('✅ Trading resumed');
}

/**
 * Check if the bot is in a healthy state
 */
export function isHealthy(): { healthy: boolean; issues: string[] } {
    const issues: string[] = [];

    if (exposure.isPaused) {
        issues.push(`Trading paused: ${exposure.pauseReason}`);
    }

    const dataAge = Date.now() - exposure.lastDataUpdate.getTime();
    if (dataAge > ENV.MAX_DATA_AGE_MS) {
        issues.push(`Data stale: ${Math.round(dataAge / 60000)} minutes old`);
    }

    if (exposure.dailyPnL < -ENV.MAX_DAILY_LOSS_USD * 0.8) {
        issues.push(`Approaching daily loss limit: $${Math.abs(exposure.dailyPnL).toFixed(2)}`);
    }

    return {
        healthy: issues.length === 0,
        issues,
    };
}

/**
 * Get current exposure summary
 */
export function getExposureSummary(): {
    totalExposure: number;
    byRegion: Record<string, number>;
    byDate: Record<string, number>;
    dailyPnL: number;
    isPaused: boolean;
    pauseReason: string | null;
} {
    let totalExposure = 0;
    for (const exp of exposure.perMarket.values()) {
        totalExposure += exp;
    }

    const byRegion: Record<string, number> = {};
    for (const [region, exp] of exposure.perRegion) {
        byRegion[region] = exp;
    }

    const byDate: Record<string, number> = {};
    for (const [date, exp] of exposure.perDate) {
        byDate[date] = exp;
    }

    return {
        totalExposure,
        byRegion,
        byDate,
        dailyPnL: exposure.dailyPnL,
        isPaused: exposure.isPaused,
        pauseReason: exposure.pauseReason,
    };
}

/**
 * Clear exposure for a resolved market
 */
export function clearMarketExposure(market: WeatherMarket): void {
    const marketExposure = exposure.perMarket.get(market.conditionId) || 0;

    exposure.perMarket.delete(market.conditionId);

    // Reduce region exposure
    const regionExp = exposure.perRegion.get(market.region) || 0;
    exposure.perRegion.set(market.region, Math.max(0, regionExp - marketExposure));

    // Reduce date exposure
    const dateExp = exposure.perDate.get(market.targetDate) || 0;
    exposure.perDate.set(market.targetDate, Math.max(0, dateExp - marketExposure));
}

export default {
    canTrade,
    recordTrade,
    recordPnL,
    recordOpenPosition,
    closePosition,
    computeUnrealizedPnL,
    checkDailyStopWithMTM,
    getOpenPositionsSummary,
    updateDataTimestamp,
    pauseTrading,
    resumeTrading,
    isHealthy,
    getExposureSummary,
    clearMarketExposure,
};
