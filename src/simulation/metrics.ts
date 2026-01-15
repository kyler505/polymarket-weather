/**
 * Simulation Metrics
 * Tracks calibration, performance, and risk metrics.
 */

export interface TradeLog {
    date: string;
    type: 'BUY' | 'SELL';
    market: string;
    binLabel: string;
    price: number;
    shares: number;
    cost: number;
    pnl: number;
    botProb: number;
    marketProb: number;
}

export interface CalibrationBucket {
    probRangeStart: number;
    probRangeEnd: number;
    count: number;
    observedWins: number;
}

export class MetricsTracker {
    trades: TradeLog[] = [];
    dailyBankroll: { date: string; balance: number }[] = [];
    brierScores: number[] = [];

    // Track calibration: Sum of (Prob - Outcome)^2

    addTrade(trade: TradeLog) {
        this.trades.push(trade);
    }

    recordDailyBalance(date: string, balance: number) {
        this.dailyBankroll.push({ date, balance });
    }

    recordBrier(probs: Map<string, number>, winnerTokenId: string) {
        // Multi-class Brier score
        // sum((prob_i - outcome_i)^2)
        let sumSqError = 0;
        for (const [id, prob] of probs) {
            const outcome = id === winnerTokenId ? 1 : 0;
            sumSqError += Math.pow(prob - outcome, 2);
        }
        this.brierScores.push(sumSqError);
    }

    getReport() {
        const totalTrades = this.trades.length;
        const totalPnL = this.trades.reduce((sum, t) => sum + t.pnl, 0);
        const wins = this.trades.filter(t => t.pnl > 0).length;
        const winRate = totalTrades > 0 ? wins / totalTrades : 0;

        // Drawdown
        let maxDrawdown = 0;
        let peak = -Infinity;
        for (const entry of this.dailyBankroll) {
            if (entry.balance > peak) peak = entry.balance;
            const dd = (peak - entry.balance) / peak;
            if (dd > maxDrawdown) maxDrawdown = dd;
        }

        // Brier Score (Lower is better)
        const avgBrier = this.brierScores.length > 0
            ? this.brierScores.reduce((a, b) => a + b, 0) / this.brierScores.length
            : 0;

        return {
            totalTrades,
            totalPnL,
            winRate,
            maxDrawdown,
            avgBrier,
            finalBalance: this.dailyBankroll[this.dailyBankroll.length-1]?.balance || 0
        };
    }
}
