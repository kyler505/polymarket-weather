/**
 * Trader Analytics Service
 * Tracks trader performance and calculates dynamic multipliers
 */

import mongoose, { Schema, Document, Model } from 'mongoose';
import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';
import Logger from '../utils/logger';

// ============================================================================
// TRADER SCORE MODEL
// ============================================================================

export interface ITraderScore extends Document {
    address: string;
    recentWinRate: number;
    recentLossRate: number;
    currentStreak: number; // Positive = wins, negative = losses
    totalTradesAnalyzed: number;
    dynamicMultiplier: number;
    lastUpdated: Date;
}

const traderScoreSchema = new Schema<ITraderScore>({
    address: { type: String, required: true, unique: true, lowercase: true, index: true },
    recentWinRate: { type: Number, default: 50 },
    recentLossRate: { type: Number, default: 50 },
    currentStreak: { type: Number, default: 0 },
    totalTradesAnalyzed: { type: Number, default: 0 },
    dynamicMultiplier: { type: Number, default: 1.0 },
    lastUpdated: { type: Date, default: Date.now },
});

let TraderScore: Model<ITraderScore>;

const getTraderScoreModel = (): Model<ITraderScore> => {
    if (!TraderScore) {
        TraderScore = mongoose.models.TraderScore || mongoose.model<ITraderScore>('TraderScore', traderScoreSchema);
    }
    return TraderScore;
};

// ============================================================================
// TRADE FETCHING
// ============================================================================

interface Trade {
    timestamp: number;
    side: 'BUY' | 'SELL';
    price: number;
    usdcSize: number;
    conditionId: string;
    outcome: string;
}

interface Position {
    conditionId: string;
    curPrice: number;
    avgPrice: number;
    outcome: string;
}

/**
 * Fetch recent trades for a trader
 */
const fetchRecentTrades = async (address: string): Promise<Trade[]> => {
    try {
        const lookbackMs = ENV.TRADER_SCORE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
        const sinceTimestamp = Date.now() - lookbackMs;

        const url = `https://data-api.polymarket.com/activity?user=${address}&limit=500`;
        const data = await fetchData(url);

        if (!Array.isArray(data)) return [];

        return (data as Trade[]).filter(t => t.timestamp * 1000 >= sinceTimestamp);
    } catch (error) {
        Logger.warning(`Failed to fetch trades for ${address}: ${error}`);
        return [];
    }
};

/**
 * Fetch current positions for a trader
 */
const fetchPositions = async (address: string): Promise<Position[]> => {
    try {
        const url = `https://data-api.polymarket.com/positions?user=${address}`;
        const data = await fetchData(url);
        return Array.isArray(data) ? (data as Position[]) : [];
    } catch (error) {
        return [];
    }
};

// ============================================================================
// ANALYSIS
// ============================================================================

interface TradeAnalysis {
    winRate: number;
    lossRate: number;
    currentStreak: number;
    totalTrades: number;
}

/**
 * Analyze trades to determine win/loss rates and streaks
 */
const analyzeTrades = (trades: Trade[], positions: Position[]): TradeAnalysis => {
    if (trades.length === 0) {
        return { winRate: 50, lossRate: 50, currentStreak: 0, totalTrades: 0 };
    }

    // Group trades by condition (market) and outcome
    const marketOutcomes: Map<string, { buys: Trade[]; sells: Trade[] }> = new Map();

    for (const trade of trades) {
        const key = `${trade.conditionId}:${trade.outcome}`;
        if (!marketOutcomes.has(key)) {
            marketOutcomes.set(key, { buys: [], sells: [] });
        }
        const group = marketOutcomes.get(key)!;
        if (trade.side === 'BUY') {
            group.buys.push(trade);
        } else {
            group.sells.push(trade);
        }
    }

    // Evaluate each market position
    const positionMap = new Map(positions.map(p => [p.conditionId, p]));
    let wins = 0;
    let losses = 0;
    const recentResults: boolean[] = []; // true = win, false = loss

    for (const [key, { buys, sells }] of marketOutcomes.entries()) {
        const [conditionId] = key.split(':');

        // Calculate average buy price and sell price
        const totalBuyValue = buys.reduce((sum, t) => sum + t.usdcSize, 0);
        const totalBuyShares = buys.reduce((sum, t) => sum + t.usdcSize / t.price, 0);
        const avgBuyPrice = totalBuyShares > 0 ? totalBuyValue / totalBuyShares : 0;

        if (sells.length > 0) {
            // Closed position - compare buy vs sell
            const totalSellValue = sells.reduce((sum, t) => sum + t.usdcSize, 0);
            const totalSellShares = sells.reduce((sum, t) => sum + t.usdcSize / t.price, 0);
            const avgSellPrice = totalSellShares > 0 ? totalSellValue / totalSellShares : 0;

            if (avgSellPrice > avgBuyPrice) {
                wins++;
                recentResults.push(true);
            } else {
                losses++;
                recentResults.push(false);
            }
        } else if (positionMap.has(conditionId)) {
            // Open position - compare to current price
            const position = positionMap.get(conditionId)!;
            if (position.curPrice > avgBuyPrice) {
                wins++;
                recentResults.push(true);
            } else {
                losses++;
                recentResults.push(false);
            }
        }
    }

    // Calculate current streak
    let currentStreak = 0;
    for (let i = recentResults.length - 1; i >= 0; i--) {
        if (i === recentResults.length - 1) {
            currentStreak = recentResults[i] ? 1 : -1;
        } else if (recentResults[i] === recentResults[i + 1]) {
            currentStreak += recentResults[i] ? 1 : -1;
        } else {
            break;
        }
    }

    const total = wins + losses;
    return {
        winRate: total > 0 ? (wins / total) * 100 : 50,
        lossRate: total > 0 ? (losses / total) * 100 : 50,
        currentStreak,
        totalTrades: total,
    };
};

/**
 * Calculate dynamic multiplier based on trader performance
 */
const calculateDynamicMultiplier = (analysis: TradeAnalysis): number => {
    let multiplier = 1.0;

    // Hot streak bonus
    if (analysis.currentStreak >= ENV.HOT_STREAK_THRESHOLD) {
        const streakBonus = 0.1 * (analysis.currentStreak - ENV.HOT_STREAK_THRESHOLD + 1);
        multiplier += Math.min(streakBonus, ENV.MAX_DYNAMIC_MULTIPLIER - 1);
    }

    // Cold streak penalty
    if (analysis.currentStreak <= -ENV.COLD_STREAK_THRESHOLD) {
        const streakPenalty = 0.15 * (Math.abs(analysis.currentStreak) - ENV.COLD_STREAK_THRESHOLD + 1);
        multiplier -= Math.min(streakPenalty, 1 - ENV.MIN_DYNAMIC_MULTIPLIER);
    }

    // Win rate adjustment
    if (analysis.winRate >= 60) {
        multiplier *= 1.1;
    } else if (analysis.winRate < 45) {
        multiplier *= 0.9;
    }

    // Clamp to configured bounds
    return Math.max(ENV.MIN_DYNAMIC_MULTIPLIER, Math.min(ENV.MAX_DYNAMIC_MULTIPLIER, multiplier));
};

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Update trader score for a single trader
 */
export const updateTraderScore = async (address: string): Promise<ITraderScore | null> => {
    if (!ENV.TRADER_SCORING_ENABLED) return null;

    try {
        const [trades, positions] = await Promise.all([
            fetchRecentTrades(address),
            fetchPositions(address),
        ]);

        const analysis = analyzeTrades(trades, positions);
        const dynamicMultiplier = calculateDynamicMultiplier(analysis);

        const model = getTraderScoreModel();
        const score = await model.findOneAndUpdate(
            { address: address.toLowerCase() },
            {
                recentWinRate: analysis.winRate,
                recentLossRate: analysis.lossRate,
                currentStreak: analysis.currentStreak,
                totalTradesAnalyzed: analysis.totalTrades,
                dynamicMultiplier,
                lastUpdated: new Date(),
            },
            { upsert: true, new: true }
        );

        // Log score update
        const streakStr = analysis.currentStreak > 0 ? `+${analysis.currentStreak}` : `${analysis.currentStreak}`;
        Logger.info(
            `📈 Trader ${address.slice(0, 8)}... score: Win ${analysis.winRate.toFixed(0)}%, Streak ${streakStr}, Multiplier ${dynamicMultiplier.toFixed(2)}x`
        );

        return score;
    } catch (error) {
        Logger.error(`Failed to update trader score for ${address}: ${error}`);
        return null;
    }
};

/**
 * Get trader score (from cache or compute)
 */
export const getTraderScore = async (address: string): Promise<ITraderScore | null> => {
    if (!ENV.TRADER_SCORING_ENABLED) return null;

    try {
        const model = getTraderScoreModel();
        const existing = await model.findOne({ address: address.toLowerCase() });

        // If score is fresh (less than 1 hour old), return cached
        if (existing && Date.now() - existing.lastUpdated.getTime() < 60 * 60 * 1000) {
            return existing;
        }

        // Otherwise, update and return
        return updateTraderScore(address);
    } catch (error) {
        return null;
    }
};

/**
 * Get dynamic multiplier for a trader
 * Returns 1.0 if scoring is disabled or no data
 */
export const getDynamicMultiplier = async (address: string): Promise<number> => {
    if (!ENV.TRADER_SCORING_ENABLED) return 1.0;

    const score = await getTraderScore(address);
    return score?.dynamicMultiplier ?? 1.0;
};

/**
 * Update all tracked traders' scores
 */
export const updateAllTraderScores = async (): Promise<void> => {
    if (!ENV.TRADER_SCORING_ENABLED) return;

    Logger.info('📊 Updating trader scores...');

    for (const address of ENV.USER_ADDRESSES) {
        await updateTraderScore(address);
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    Logger.info('✅ Trader scores updated');
};
