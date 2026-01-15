/**
 * Position Manager Service
 * Monitors positions and executes stop-loss / take-profit orders
 */

import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';
import Logger from '../utils/logger';
import { getBestBid } from '../utils/orderUtils';
import { sleep } from '../utils/rateLimiter';
import createClobClient from '../utils/createClobClient';

const PROXY_WALLET = ENV.PROXY_WALLET;

interface Position {
    asset: string;
    conditionId: string;
    size: number;
    avgPrice: number;
    currentValue: number;
    curPrice: number;
    title?: string;
    outcome?: string;
    slug?: string;
    cashPnl?: number;
    percentPnl?: number;
}

interface PositionWithPeak extends Position {
    peakPrice: number; // For trailing stop
    peakPnlPercent: number; // Peak P&L percentage
}

// In-memory tracking for trailing stops (persisted to MongoDB)
let positionPeaks: Map<string, { peakPrice: number; peakPnlPercent: number }> = new Map();
let peaksLoaded = false;

// Import state persistence
import {
    saveState,
    loadState,
    STATE_KEYS,
    serializeMap,
    deserializeMap,
} from '../utils/statePersistence';

let isRunning = false;
let timeoutId: NodeJS.Timeout | null = null;
let clobClientInstance: ClobClient | null = null;

/**
 * Load persisted peak state from MongoDB
 */
const loadPeakState = async (): Promise<void> => {
    if (peaksLoaded) return;

    try {
        const saved = await loadState<Record<string, { peakPrice: number; peakPnlPercent: number }> | null>(
            STATE_KEYS.POSITION_PEAKS,
            null
        );
        if (saved) {
            positionPeaks = deserializeMap(saved);
            Logger.info(`📈 Loaded ${positionPeaks.size} trailing stop peaks from DB`);
        }
        peaksLoaded = true;
    } catch (error) {
        Logger.warning(`Failed to load peak state: ${error}`);
    }
};

/**
 * Save peak state to MongoDB (debounced)
 */
let peakSaveTimeout: NodeJS.Timeout | null = null;
const savePeakState = (): void => {
    if (peakSaveTimeout) clearTimeout(peakSaveTimeout);
    peakSaveTimeout = setTimeout(async () => {
        try {
            const serialized = serializeMap(positionPeaks);
            await saveState(STATE_KEYS.POSITION_PEAKS, serialized);
        } catch (error) {
            Logger.warning(`Failed to save peak state: ${error}`);
        }
    }, 5000);
};

/**
 * Load current positions from Polymarket API
 */
const loadPositions = async (): Promise<Position[]> => {
    try {
        const url = `https://data-api.polymarket.com/positions?user=${PROXY_WALLET}`;
        const data = await fetchData(url);
        return Array.isArray(data) ? (data as Position[]).filter(p => p.size > 0.0001) : [];
    } catch (error) {
        Logger.error(`Failed to load positions: ${error}`);
        return [];
    }
};

/**
 * Calculate P&L percentage for a position
 */
const calculatePnlPercent = (position: Position): number => {
    if (position.avgPrice <= 0) return 0;
    return ((position.curPrice - position.avgPrice) / position.avgPrice) * 100;
};

/**
 * Update peak tracking for trailing stop
 */
const updatePeakTracking = (position: Position): PositionWithPeak => {
    const key = position.conditionId;
    const currentPnlPercent = calculatePnlPercent(position);
    const existing = positionPeaks.get(key);

    if (!existing || position.curPrice > existing.peakPrice) {
        positionPeaks.set(key, {
            peakPrice: position.curPrice,
            peakPnlPercent: Math.max(currentPnlPercent, existing?.peakPnlPercent || 0),
        });
        savePeakState(); // Persist on update
    }

    const peaks = positionPeaks.get(key)!;
    return {
        ...position,
        peakPrice: peaks.peakPrice,
        peakPnlPercent: peaks.peakPnlPercent,
    };
};

/**
 * Check if stop-loss should trigger
 */
const shouldTriggerStopLoss = (position: Position): boolean => {
    if (!ENV.STOP_LOSS_ENABLED) return false;

    const pnlPercent = calculatePnlPercent(position);
    return pnlPercent <= -ENV.STOP_LOSS_PERCENT;
};

/**
 * Check if take-profit should trigger
 */
const shouldTriggerTakeProfit = (position: Position): boolean => {
    if (!ENV.TAKE_PROFIT_ENABLED) return false;

    const pnlPercent = calculatePnlPercent(position);
    return pnlPercent >= ENV.TAKE_PROFIT_PERCENT;
};

/**
 * Check if trailing stop should trigger
 */
const shouldTriggerTrailingStop = (position: PositionWithPeak): boolean => {
    if (!ENV.TRAILING_STOP_ENABLED) return false;

    const currentPnlPercent = calculatePnlPercent(position);

    // Only apply trailing stop if we've been in profit
    if (position.peakPnlPercent < ENV.TRAILING_STOP_PERCENT) return false;

    // Trigger if price dropped TRAILING_STOP_PERCENT from peak
    const dropFromPeak = position.peakPnlPercent - currentPnlPercent;
    return dropFromPeak >= ENV.TRAILING_STOP_PERCENT;
};
import { notifyStopLoss, notifyTakeProfit, notifyTrailingStop } from './discordNotifier';

/**
 * Execute a sell order for a position
 */
const executeSell = async (
    clobClient: ClobClient,
    position: Position,
    reason: 'stop-loss' | 'take-profit' | 'trailing-stop',
    peakPnl?: number
): Promise<boolean> => {
    try {
        const pnlPercent = calculatePnlPercent(position);
        Logger.info(`🔔 ${reason.toUpperCase()} triggered for ${position.title || position.conditionId}`);
        Logger.info(`   Current P&L: ${pnlPercent.toFixed(1)}%, Size: ${position.size.toFixed(2)} tokens`);

        const orderBook = await clobClient.getOrderBook(position.asset);
        const bestBid = getBestBid(orderBook.bids || []);

        if (!bestBid) {
            Logger.warning(`   No bids available for ${position.title || position.conditionId}`);
            return false;
        }

        const bidPrice = parseFloat(bestBid.price);

        // Safety check: Don't sell at too low a price (prevents bad fills in thin markets)
        const expectedPrice = position.curPrice;
        const minAcceptablePrice = expectedPrice * (ENV.SL_TP_MIN_PRICE_PERCENT / 100);

        if (bidPrice < minAcceptablePrice) {
            Logger.warning(`   Best bid $${bidPrice.toFixed(3)} below minimum $${minAcceptablePrice.toFixed(3)} - skipping`);
            return false;
        }

        // Execute sell
        const sellAmount = Math.min(position.size, parseFloat(bestBid.size));
        const orderArgs = {
            side: Side.SELL,
            tokenID: position.asset,
            amount: sellAmount,
            price: bidPrice,
        };

        const signedOrder = await clobClient.createMarketOrder(orderArgs);
        const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);

        if (resp.success === true) {
            Logger.success(`   ✅ ${reason.toUpperCase()}: Sold ${sellAmount.toFixed(2)} tokens at $${bidPrice.toFixed(3)}`);

            // Clear peak tracking for this position
            positionPeaks.delete(position.conditionId);

            // Send Discord notification
            const marketName = position.title || position.conditionId.slice(0, 10) + '...';
            if (reason === 'stop-loss') {
                notifyStopLoss({ market: marketName, tokens: sellAmount, price: bidPrice, pnlPercent });
            } else if (reason === 'take-profit') {
                notifyTakeProfit({ market: marketName, tokens: sellAmount, price: bidPrice, pnlPercent });
            } else if (reason === 'trailing-stop') {
                notifyTrailingStop({ market: marketName, tokens: sellAmount, price: bidPrice, pnlPercent, peakPnl: peakPnl || 0 });
            }

            return true;
        } else {
            Logger.warning(`   ❌ ${reason.toUpperCase()} sell failed`);
            return false;
        }
    } catch (error) {
        Logger.error(`   Error executing ${reason}: ${error}`);
        return false;
    }
};

/**
 * Check all positions for SL/TP triggers
 */
const checkPositions = async (): Promise<void> => {
    if (!clobClientInstance) {
        try {
            clobClientInstance = await createClobClient();
        } catch (error) {
            Logger.error(`Position Manager: Failed to create CLOB client: ${error}`);
            return;
        }
    }

    const anyFeatureEnabled = ENV.STOP_LOSS_ENABLED || ENV.TAKE_PROFIT_ENABLED || ENV.TRAILING_STOP_ENABLED;
    if (!anyFeatureEnabled) return;

    try {
        const positions = await loadPositions();

        if (positions.length === 0) return;

        Logger.info(`📊 Position Manager: Checking ${positions.length} positions for SL/TP triggers`);

        for (const position of positions) {
            const positionWithPeak = updatePeakTracking(position);

            // Check triggers in order of priority
            if (shouldTriggerStopLoss(position)) {
                await executeSell(clobClientInstance, position, 'stop-loss');
                await sleep(2000); // Delay between sells
            } else if (shouldTriggerTakeProfit(position)) {
                await executeSell(clobClientInstance, position, 'take-profit');
                await sleep(2000);
            } else if (shouldTriggerTrailingStop(positionWithPeak)) {
                await executeSell(clobClientInstance, position, 'trailing-stop', positionWithPeak.peakPnlPercent);
                await sleep(2000);
            }
        }
    } catch (error) {
        Logger.error(`Position Manager Error: ${error}`);
    }
};

/**
 * Start the position manager service
 */
export const startPositionManager = (): void => {
    const anyFeatureEnabled = ENV.STOP_LOSS_ENABLED || ENV.TAKE_PROFIT_ENABLED || ENV.TRAILING_STOP_ENABLED;

    if (!anyFeatureEnabled) {
        Logger.info('Position Manager: No SL/TP features enabled, skipping startup');
        return;
    }

    if (isRunning) return;
    isRunning = true;

    Logger.info('🛡️  Starting Position Manager (SL/TP monitoring)...');
    Logger.info(`   Stop-Loss: ${ENV.STOP_LOSS_ENABLED ? `${ENV.STOP_LOSS_PERCENT}%` : 'DISABLED'}`);
    Logger.info(`   Take-Profit: ${ENV.TAKE_PROFIT_ENABLED ? `${ENV.TAKE_PROFIT_PERCENT}%` : 'DISABLED'}`);
    Logger.info(`   Trailing Stop: ${ENV.TRAILING_STOP_ENABLED ? `${ENV.TRAILING_STOP_PERCENT}%` : 'DISABLED'}`);
    Logger.info(`   Check Interval: ${(ENV.POSITION_CHECK_INTERVAL_MS / 1000).toFixed(0)}s`);

    // Load persisted peak state before first check
    loadPeakState().then(() => {
        // Run immediately
        checkPositions();

        // Then schedule recurring checks
        const runLoop = async () => {
            if (!isRunning) return;
            timeoutId = setTimeout(async () => {
                await checkPositions();
                runLoop();
            }, ENV.POSITION_CHECK_INTERVAL_MS);
        };

        runLoop();
    });
};

/**
 * Stop the position manager service
 */
export const stopPositionManager = (): void => {
    isRunning = false;
    if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
    }
    Logger.info('Position Manager stopped');
};

/**
 * Get current peak tracking data (for debugging)
 */
export const getPeakTracking = (): Map<string, { peakPrice: number; peakPnlPercent: number }> => {
    return new Map(positionPeaks);
};
