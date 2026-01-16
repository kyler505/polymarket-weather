/**
 * Weather Monitor
 * Monitors weather markets and generates trading signals
 */

import { ENV } from '../config/env';
import { WeatherMarket, WeatherTradeSignal, BinProbability } from '../interfaces/WeatherMarket';
import { discoverWeatherMarkets, getUpcomingMarkets, refreshMarketPrices } from './weatherMarketDiscovery';
import { getForecast, getEnsembleForecast, getDailyMaxSoFar } from './weatherDataService';
import { analyzeBinProbabilities, shouldTrade, kellyFraction } from './probabilityEngine';
import { canTrade, updateDataTimestamp } from './weatherRiskManager';
import Logger from '../utils/logger';
import { addJitter } from '../utils/rateLimiter';

// Trade queue for the executor
const tradeQueue: WeatherTradeSignal[] = [];

// Tracked markets
let trackedMarkets: WeatherMarket[] = [];

// Monitor state
let isRunning = false;
let lastDiscovery = new Date(0);

/**
 * Get pending trade signals
 */
export function getPendingSignals(): WeatherTradeSignal[] {
    return [...tradeQueue];
}

/**
 * Remove a signal from the queue (after execution)
 */
export function removeSignal(signal: WeatherTradeSignal): void {
    const index = tradeQueue.findIndex(s =>
        s.market.conditionId === signal.market.conditionId &&
        s.bin.tokenId === signal.bin.tokenId
    );
    if (index !== -1) {
        tradeQueue.splice(index, 1);
    }
}

/**
 * Process a single market - fetch forecast, compute probabilities, generate signals
 */
async function processMarket(market: WeatherMarket, prices: Map<string, number>): Promise<void> {
    try {
        // Calculate lead days
        const now = new Date();
        const targetDate = new Date(market.targetDate);
        const leadDays = Math.ceil((targetDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

        // Check if this is day-of
        const isDayOf = leadDays <= 0;

        // Get forecast
        const forecast = await getEnsembleForecast(market.stationId, market.targetDate);
        if (!forecast) {
            Logger.debug(`No forecast available for ${market.stationId} on ${market.targetDate}`);
            return;
        }

        // Get max-so-far if day-of
        let maxSoFar: number | undefined;
        if (isDayOf && market.metric === 'DAILY_MAX_TEMP') {
            maxSoFar = (await getDailyMaxSoFar(market.stationId)) || undefined;
            if (maxSoFar !== undefined) {
                Logger.debug(`Day-of max so far for ${market.stationId}: ${maxSoFar}°F`);
            }
        }

        // Analyze bin probabilities
        const binAnalysis = analyzeBinProbabilities(market, forecast, prices, maxSoFar);

        // Log analysis for debugging
        Logger.debug(`Market: ${market.title.substring(0, 40)}...`);
        Logger.debug(`  Forecast: ${forecast.forecastHigh}°F (σ=${forecast.leadDays}d)`);

        // Generate signals for bins with edge
        for (const bin of binAnalysis) {
            // Adjust edge for expected execution friction (spread/slippage)
            // For BUY: we pay ask = mid + spread/2, so effective edge is lower
            // For SELL: we receive bid = mid - spread/2, so effective edge is also lower
            const EXPECTED_SPREAD = 0.02; // 2% total spread (configurable)
            const frictionAdjustedEdge = bin.edge - (EXPECTED_SPREAD / 2);

            const decision = shouldTrade(
                frictionAdjustedEdge,  // Use friction-adjusted edge
                ENV.WEATHER_EDGE_THRESHOLD,
                bin.fairProbability,
                bin.isPossible
            );

            if (decision.shouldTrade) {
                // Calculate position size using Kelly criterion
                const kellyPct = kellyFraction(bin.fairProbability, bin.marketPrice, 0.1);
                const recommendedSize = Math.min(
                    kellyPct * 100, // Assuming $100 base for now
                    ENV.MAX_ORDER_SIZE_USD
                );

                // Check risk limits
                const riskCheck = canTrade(market, recommendedSize);
                if (!riskCheck.allowed) {
                    Logger.debug(`  ${bin.label}: Edge ${(bin.edge * 100).toFixed(1)}% but ${riskCheck.reason}`);
                    continue;
                }

                // Find the bin object
                const binObj = market.bins.find(b => b.tokenId === bin.outcomeId);
                if (!binObj) continue;

                const signal: WeatherTradeSignal = {
                    market,
                    bin: binObj,
                    side: decision.side,
                    fairProbability: bin.fairProbability,
                    marketPrice: bin.marketPrice,
                    edge: bin.edge,
                    recommendedSizeUSD: recommendedSize,
                    reason: decision.reason,
                    forecast,
                    maxSoFar,
                    generatedAt: new Date(),
                };

                // Check if already in queue
                const existing = tradeQueue.find(s =>
                    s.market.conditionId === market.conditionId &&
                    s.bin.tokenId === binObj.tokenId
                );

                if (!existing) {
                    tradeQueue.push(signal);
                    Logger.info(`📊 Signal: ${decision.side} ${bin.label} @ $${bin.marketPrice.toFixed(2)} (fair: $${bin.fairProbability.toFixed(2)}, edge: ${(bin.edge * 100).toFixed(1)}%)`);
                }
            }
        }
    } catch (error) {
        Logger.error(`Error processing market ${market.conditionId}: ${error}`);
    }
}

/**
 * Main monitoring loop iteration
 */
async function monitorCycle(): Promise<void> {
    try {
        // Discover new markets periodically
        const timeSinceDiscovery = Date.now() - lastDiscovery.getTime();
        if (timeSinceDiscovery > ENV.WEATHER_DISCOVERY_INTERVAL_MS) {
            Logger.info('Running market discovery...');
            trackedMarkets = await discoverWeatherMarkets();
            lastDiscovery = new Date();
        }

        // Get markets within trading window
        const marketsToProcess = await getUpcomingMarkets();
        if (marketsToProcess.length === 0) {
            Logger.debug('No markets within trading window');
            return;
        }

        Logger.info(`Processing ${marketsToProcess.length} markets...`);

        // Refresh market prices
        const allPrices = await refreshMarketPrices(marketsToProcess);
        updateDataTimestamp();

        // Process each market
        for (const market of marketsToProcess) {
            const prices = allPrices.get(market.conditionId) || new Map();
            await processMarket(market, prices);
        }

        Logger.info(`Trade queue has ${tradeQueue.length} pending signals`);

    } catch (error) {
        Logger.error(`Monitor cycle error: ${error}`);
    }
}

/**
 * Start the weather monitor
 */
export async function startWeatherMonitor(): Promise<void> {
    if (isRunning) {
        Logger.warning('Weather monitor already running');
        return;
    }

    isRunning = true;
    Logger.success('Weather Monitor started');

    // Initial discovery
    Logger.info('Running initial market discovery...');
    trackedMarkets = await discoverWeatherMarkets();
    lastDiscovery = new Date();

    // Main loop
    while (isRunning) {
        await monitorCycle();

        // Wait with jitter
        const waitTime = addJitter(ENV.WEATHER_FORECAST_REFRESH_MS, 0.1);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    Logger.info('Weather Monitor stopped');
}

/**
 * Stop the weather monitor
 */
export function stopWeatherMonitor(): void {
    isRunning = false;
    Logger.info('Weather Monitor shutdown requested');
}

/**
 * Get current status
 */
export function getMonitorStatus(): {
    isRunning: boolean;
    trackedMarkets: number;
    pendingSignals: number;
    lastDiscovery: Date;
} {
    return {
        isRunning,
        trackedMarkets: trackedMarkets.length,
        pendingSignals: tradeQueue.length,
        lastDiscovery,
    };
}

export default {
    startWeatherMonitor,
    stopWeatherMonitor,
    getMonitorStatus,
    getPendingSignals,
    removeSignal,
};
