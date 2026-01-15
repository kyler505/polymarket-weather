/**
 * Weather Executor
 * Executes weather trading signals by placing orders on Polymarket
 */

import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { ENV } from '../config/env';
import { WeatherTradeSignal } from '../interfaces/WeatherMarket';
import { getPendingSignals, removeSignal } from './weatherMonitor';
import { recordTrade, canTrade, isHealthy } from './weatherRiskManager';
import { updateBotPosition, reduceBotPosition } from '../models/botPositions';
import Logger from '../utils/logger';
import { addJitter } from '../utils/rateLimiter';
import { notifyTrade } from './discordNotifier';
import { PaperTradingService } from './paperTradingService';

// Executor state
let isRunning = false;
let clobClient: ClobClient | null = null;

/**
 * Place a limit order for a trade signal
 */
async function executeSignal(signal: WeatherTradeSignal): Promise<boolean> {
    if (!clobClient) {
        Logger.error('CLOB client not initialized');
        return false;
    }

    // Dry run check
    if (ENV.WEATHER_DRY_RUN) {
        Logger.info(`[DRY RUN] Simulating trade: ${signal.side} ${signal.bin.label} @ $${signal.marketPrice.toFixed(3)} for $${signal.recommendedSizeUSD.toFixed(2)}`);

        PaperTradingService.getInstance().recordTrade({
            marketTitle: signal.market.title,
            outcomeLabel: signal.bin.label,
            side: signal.side,
            price: signal.marketPrice,
            amountUSD: signal.recommendedSizeUSD,
            conditionId: signal.market.conditionId,
            assetId: signal.bin.tokenId // Using tokenId as assetId
        });

        // Send Discord notification for Dry Run
        try {
            await notifyTrade({
                side: signal.side,
                market: signal.market.title,
                outcome: signal.bin.label,
                price: signal.marketPrice,
                size: signal.recommendedSizeUSD,
                edge: signal.edge,
                reason: signal.reason,
                isDryRun: true
            });
        } catch (notifyError) {
            Logger.debug(`Dry run discord notification failed: ${notifyError}`);
        }

        return true;
    }

    try {
        // Double-check risk limits
        const riskCheck = canTrade(signal.market, signal.recommendedSizeUSD);
        if (!riskCheck.allowed) {
            Logger.warning(`Trade rejected by risk manager: ${riskCheck.reason}`);
            return false;
        }

        // Calculate order parameters
        const tokenId = signal.bin.tokenId;
        const side = signal.side;

        // For limit orders, place slightly better than market for better fills
        // If buying, bid slightly below fair; if selling, ask slightly above fair
        const priceOffset = 0.01; // 1% from fair value
        let orderPrice: number;

        if (side === 'BUY') {
            orderPrice = Math.min(signal.fairProbability - priceOffset, signal.marketPrice);
        } else {
            orderPrice = Math.max(signal.fairProbability + priceOffset, signal.marketPrice);
        }

        // Clamp price to valid range
        orderPrice = Math.max(0.01, Math.min(0.99, orderPrice));

        // Calculate size in tokens
        const tokenAmount = signal.recommendedSizeUSD / orderPrice;

        Logger.info(`Placing ${side} order: ${signal.bin.label} @ $${orderPrice.toFixed(3)} for ~$${signal.recommendedSizeUSD.toFixed(2)}`);

        // Create and place the order using CLOB client
        const order = await clobClient.createOrder({
            tokenID: tokenId,
            price: orderPrice,
            size: tokenAmount,
            side: side === 'BUY' ? Side.BUY : Side.SELL,
        });

        const result = await clobClient.postOrder(order, OrderType.GTC);

        if (result.success) {
            Logger.success(`Order placed: ${result.orderID || 'unknown ID'}`);

            // Record the trade
            recordTrade(signal.market, signal.recommendedSizeUSD, side);

            // Update bot positions
            if (side === 'BUY') {
                await updateBotPosition(
                    signal.market.conditionId,
                    signal.bin.tokenId,
                    tokenAmount,
                    signal.recommendedSizeUSD
                );
            } else {
                await reduceBotPosition(
                    signal.market.conditionId,
                    tokenAmount,
                    signal.recommendedSizeUSD
                );
            }

            // Send Discord notification
            try {
                await notifyTrade({
                    side,
                    market: signal.market.title,
                    outcome: signal.bin.label,
                    price: orderPrice,
                    size: signal.recommendedSizeUSD,
                    edge: signal.edge,
                    reason: signal.reason,
                });
            } catch (notifyError) {
                Logger.debug(`Discord notification failed: ${notifyError}`);
            }

            return true;
        } else {
            Logger.warning(`Order failed: ${result.errorMsg || 'unknown error'}`);
            return false;
        }

    } catch (error) {
        Logger.error(`Error executing signal: ${error}`);
        return false;
    }
}

/**
 * Main executor loop iteration
 */
async function executorCycle(): Promise<void> {
    // Check health status
    const health = isHealthy();
    if (!health.healthy) {
        Logger.debug(`Executor paused: ${health.issues.join(', ')}`);
        return;
    }

    // Get pending signals
    const signals = getPendingSignals();
    if (signals.length === 0) {
        return;
    }

    Logger.info(`Processing ${signals.length} pending signals...`);

    // Process signals one at a time
    for (const signal of signals) {
        // Check if signal is still fresh (within 5 minutes)
        const signalAge = Date.now() - signal.generatedAt.getTime();
        if (signalAge > 5 * 60 * 1000) {
            Logger.debug(`Signal expired: ${signal.bin.label} (${Math.round(signalAge / 60000)} min old)`);
            removeSignal(signal);
            continue;
        }

        // Execute the signal
        const success = await executeSignal(signal);

        // Remove from queue regardless of success (we don't retry automatically)
        removeSignal(signal);

        if (success) {
            // Wait a bit between successful orders to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

/**
 * Start the weather executor
 */
export async function startWeatherExecutor(client: ClobClient): Promise<void> {
    if (isRunning) {
        Logger.warning('Weather Executor already running');
        return;
    }

    clobClient = client;
    isRunning = true;

    if (ENV.WEATHER_DRY_RUN) {
        Logger.warning('⚠️  Weather Executor running in DRY RUN mode - no real trades will be placed');
    } else {
        Logger.success('Weather Executor started');
    }

    // Main loop
    while (isRunning) {
        await executorCycle();

        // Wait with jitter
        const waitTime = addJitter(ENV.EXECUTOR_POLL_INTERVAL_MS, 0.2);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    Logger.info('Weather Executor stopped');
}

/**
 * Stop the weather executor
 */
export function stopWeatherExecutor(): void {
    isRunning = false;
    Logger.info('Weather Executor shutdown requested');
}

/**
 * Get executor status
 */
export function getExecutorStatus(): {
    isRunning: boolean;
    isDryRun: boolean;
    clientReady: boolean;
} {
    return {
        isRunning,
        isDryRun: ENV.WEATHER_DRY_RUN,
        clientReady: clobClient !== null,
    };
}

export default {
    startWeatherExecutor,
    stopWeatherExecutor,
    getExecutorStatus,
};
