/**
 * Market Simulator
 * Generates the "Market's View" (Order Book) and handles trade execution with frictions.
 */

import { WeatherBin, WeatherMarket } from '../interfaces/WeatherMarket';
import { computeBinProbabilities } from '../services/probabilityEngine';
import { WeatherForecast } from '../interfaces/WeatherMarket';

export interface MarketConfig {
    vig: number;        // Overround (e.g. 0.05 for 5%)
    spread: number;     // Bid-Ask spread (e.g. 0.02 cents)
    liquidity: number;  // Price impact factor (price moves X per $1000)
}

export interface OrderBook {
    bids: Map<string, number>; // tokenId -> best bid
    asks: Map<string, number>; // tokenId -> best ask
    fairProbs: Map<string, number>; // Underlying fair probs (for debugging)
}

/**
 * Generate a synthetic Market Order Book
 */
export function generateOrderBook(
    marketForecast: WeatherForecast,
    bins: WeatherBin[],
    config: MarketConfig
): OrderBook {
    // 1. Calculate Market's Fair Probabilities
    // The market sees 'marketForecast' (which might be different from bot's forecast)
    const probs = computeBinProbabilities(marketForecast, bins, 'DAILY_MAX_TEMP');

    // 2. Apply Overround (Vig)
    // Polymarket sum(ask_prices) > 1.0 (usually 1.02-1.05)
    // We normalize probs to sum to (1 + vig)
    const totalProb = Array.from(probs.values()).reduce((a, b) => a + b, 0);
    // Usually probs sum to 1.0 from computeBinProbabilities.

    const bids = new Map<string, number>();
    const asks = new Map<string, number>();
    const fairProbs = new Map<string, number>();

    for (const bin of bins) {
        const p = probs.get(bin.tokenId) || 0;
        fairProbs.set(bin.tokenId, p);

        // Market Maker Logic:
        // Midpoint = p
        // Ask = p * (1 + vig/2) + spread/2
        // Bid = p * (1 - vig/2) - spread/2

        // This is a simple model.
        // Alternative: Renormalize p items so sum is 1.05.
        // Let's use simple spread around true prob, shifted by vig.
        // Actually, vig usually means you buy at expensive, sell at cheap.

        let ask = p + (config.vig / 2 * p) + (config.spread / 2);
        let bid = p - (config.vig / 2 * p) - (config.spread / 2);

        // Clamp
        ask = Math.min(0.99, Math.max(0.01, ask));
        bid = Math.min(0.99, Math.max(0.01, bid));

        // Ensure Bid < Ask
        if (bid > ask) {
             const mid = (bid + ask) / 2;
             bid = mid - 0.005;
             ask = mid + 0.005;
        }

        bids.set(bin.tokenId, bid);
        asks.set(bin.tokenId, ask);
    }

    return { bids, asks, fairProbs };
}

/**
 * Execute a trade against the simulated order book
 * Returns: { filled: boolean, fillPrice: number, fee: number }
 */
export function simulateTradeExecution(
    side: 'BUY' | 'SELL',
    tokenId: string,
    sizeUSD: number,
    orderBook: OrderBook,
    config: MarketConfig
): { filled: boolean; fillPrice: number; slippage: number } {
    let priceItem = side === 'BUY' ? orderBook.asks.get(tokenId) : orderBook.bids.get(tokenId);

    if (priceItem === undefined) {
        return { filled: false, fillPrice: 0, slippage: 0 };
    }

    // Price Impact Logic
    // Price worsens as Size increases.
    // Linear model: effective_price = base_price +/- (slope * size)
    // slope approx: 1 cent per $1000? -> 0.01 / 1000 = 0.00001
    // Let's leverage config.liquidity

    const impact = sizeUSD * config.liquidity;
    let fillPrice = priceItem;

    if (side === 'BUY') {
        fillPrice += impact;
        fillPrice = Math.min(0.99, fillPrice);
    } else {
        fillPrice -= impact;
        fillPrice = Math.max(0.01, fillPrice);
    }

    const slippage = Math.abs(fillPrice - priceItem);

    return {
        filled: true,
        fillPrice,
        slippage
    };
}
