/**
 * Backtest Runner
 * Orchestrates the time-travel simulation
 */

import chalk from 'chalk';
import { getHistoricalDailyData } from '../services/weatherDataService';
import { getSimulatedForecast, ForecastConfig } from './forecastSimulator';
import { generateOrderBook, simulateTradeExecution, MarketConfig } from './marketSimulator';
import { MetricsTracker } from './metrics';
import { computeBinProbabilities, kellyFraction } from '../services/probabilityEngine';
import { WeatherBin } from '../interfaces/WeatherMarket';
import { findStationByName } from '../config/weatherConfig';

export interface BacktestConfig {
    city: string;
    days: number;
    initialBankroll: number;
    forecastConfig: ForecastConfig;
    marketConfig: MarketConfig;
    strategyConfig?: {
        kellyMultiplier: number;
        edgeThreshold: number;
    };
}

// Helper to generate bins (copied from original script)
function generateSyntheticBins(temp: number): WeatherBin[] {
    const center = Math.round(temp / 10) * 10;
    return [
        { outcomeId: '1', tokenId: '1', label: `<${center-10}`, lowerBound: null, upperBound: center-10, isFloor: true, isCeiling: false },
        { outcomeId: '2', tokenId: '2', label: `${center-10}-${center}`, lowerBound: center-10, upperBound: center, isFloor: false, isCeiling: false },
        { outcomeId: '3', tokenId: '3', label: `${center}-${center+10}`, lowerBound: center, upperBound: center+10, isFloor: false, isCeiling: false },
        { outcomeId: '4', tokenId: '4', label: `${center+10}-${center+20}`, lowerBound: center+10, upperBound: center+20, isFloor: false, isCeiling: false },
        { outcomeId: '5', tokenId: '5', label: `>${center+20}`, lowerBound: center+20, upperBound: null, isFloor: false, isCeiling: true },
    ];
}

function getDates(startDate: Date, days: number): string[] {
    const dates: string[] = [];
    for (let i = 0; i < days; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() - (days - i));
        dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
}

export async function runBacktest(config: BacktestConfig) {
    const tracker = new MetricsTracker();
    let bankroll = config.initialBankroll;

    const station = findStationByName(config.city);
    if (!station) throw new Error(`Station not found: ${config.city}`);

    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1); // Start from yesterday
    const dates = getDates(endDate, config.days);

    console.log(`Running backtest for ${config.city} (${dates[0]} to ${dates[dates.length-1]})`);
    console.log(`Mode: ${config.forecastConfig.mode}`);

    for (const date of dates) {
        // 1. Get Truth
        const actuals = await getHistoricalDailyData(station.id, date);
        if (!actuals) continue;

        // 2. Bot Forecast
        const botForecast = await getSimulatedForecast(
            station.id,
            date,
            3, // 3 day lookahead
            { max: actuals.maxTemp, min: actuals.minTemp },
            config.forecastConfig
        );

        // 3. Market Forecast (Simulated Competitor)
        // Market usually has "good" info too, maybe slightly different noise
        const marketForecast = await getSimulatedForecast(
            station.id,
            date,
            3,
            { max: actuals.maxTemp, min: actuals.minTemp },
            {
                mode: 'SYNTHETIC',
                syntheticParams: { biasMean: 0, noiseScale: 1.0, useStudentT: false }
            }
        );

        // 4. Generate Market
        const bins = generateSyntheticBins(marketForecast.forecastHigh!);
        const orderBook = generateOrderBook(marketForecast, bins, config.marketConfig);

        // 5. Bot Decision
        const botProbs = computeBinProbabilities(botForecast, bins, 'DAILY_MAX_TEMP');

        // Record Brier Score for Bot
        // Determine winner
        let winnerId = '';
        for (const bin of bins) {
             let won = false;
             if (bin.lowerBound !== null && bin.upperBound !== null) {
                won = actuals.maxTemp >= bin.lowerBound && actuals.maxTemp < bin.upperBound;
             } else if (bin.lowerBound === null && bin.upperBound !== null) {
                won = actuals.maxTemp < bin.upperBound;
             } else if (bin.lowerBound !== null && bin.upperBound === null) {
                won = actuals.maxTemp >= bin.lowerBound;
             }
             if(won) winnerId = bin.tokenId;
        }
        tracker.recordBrier(botProbs, winnerId);

        // Trade Loop
        let dailyPnl = 0;
        for (const bin of bins) {
             const botP = botProbs.get(bin.tokenId) || 0;
             const mktBid = orderBook.bids.get(bin.tokenId) || 0;
             const mktAsk = orderBook.asks.get(bin.tokenId) || 1;

             // Check Buy Edge
             if (botP > mktAsk) {
                 const edge = botP - mktAsk;
                 const kellyMult = config.strategyConfig?.kellyMultiplier ?? 0.25;
                 const edgeThresh = config.strategyConfig?.edgeThreshold ?? 0.02;

                 const f = kellyFraction(botP, mktAsk, kellyMult);
                 if (f > 0 && edge > edgeThresh) {
                     const size = bankroll * f;
                     const exec = simulateTradeExecution('BUY', bin.tokenId, size, orderBook, config.marketConfig);
                     if (exec.filled) {
                         // Resolve
                         const won = bin.tokenId === winnerId;
                         const shares = size / exec.fillPrice;
                         const pnl = won ? (shares - size) : -size;

                         bankroll += pnl;
                         dailyPnl += pnl;

                         tracker.addTrade({
                             date,
                             type: 'BUY',
                             market: 'DAILY_MAX',
                             binLabel: bin.label,
                             price: exec.fillPrice,
                             shares,
                             cost: size,
                             pnl,
                             botProb: botP,
                             marketProb: mktAsk
                         });

                         console.log(`${date}: BUY ${bin.label} @ ${exec.fillPrice.toFixed(2)} | PnL: ${pnl.toFixed(2)}`);
                     }
                 }
             }

             // Sell Logic (omitted for simplicity, focused on long-only for now)
        }

        tracker.recordDailyBalance(date, bankroll);
    }

    return tracker.getReport();
}
