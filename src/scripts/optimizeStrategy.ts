/**
 * Strategy Optimizer (Multi-Seed Robust Version)
 * Runs a grid search over strategy parameters with multiple random seeds.
 *
 * Usage: npm run optimize
 */

import chalk from 'chalk';
import { runBacktest, BacktestConfig } from '../simulation/backtestRunner';
import { findStationByName } from '../config/weatherConfig';
import { ForecastConfig, setSeed, clearSeed } from '../simulation/forecastSimulator';

// Optimization Configuration
const CITY = 'NYC';
const DAYS = 60;
const INITIAL_BANKROLL = 1000;

// Multi-seed configuration
const NUM_SEEDS = 10; // Run each config with 10 different seeds
const SEEDS = Array.from({ length: NUM_SEEDS }, (_, i) => 12345 + i * 1000); // [12345, 13345, ...]

const PARAM_GRIDS = {
    kellyMultiplier: [0.05, 0.1, 0.15, 0.2, 0.25],
    edgeThreshold: [0.03, 0.05, 0.08, 0.10, 0.12]
};

// Fixed config for now
const FORECAST_CONFIG: ForecastConfig = {
    mode: 'SYNTHETIC',
    syntheticParams: {
        biasMean: 0,
        noiseScale: 1.0,
        useStudentT: false
    }
};

const MARKET_CONFIG = {
    vig: 0.05,
    spread: 0.02,
    liquidity: 0.0001
};

interface SeedResult {
    seed: number;
    totalPnL: number;
    maxDrawdown: number;
    winRate: number;
    tradeCount: number;
}

interface AggregatedResult {
    params: { kelly: number, edge: number };
    // Aggregated across seeds
    medianPnL: number;
    p25PnL: number;            // 25th percentile (robust)
    worstPnL: number;
    medianDrawdown: number;
    worstDrawdown: number;
    avgTradeCount: number;
    calmarRatio: number;       // Based on median
    seedResults: SeedResult[];
}

function median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(arr: number[], p: number): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * p);
    return sorted[Math.min(idx, sorted.length - 1)];
}

async function runOptimization() {
    console.log(chalk.cyan.bold('🚀 Multi-Seed Strategy Optimizer Starting...'));
    console.log(`Grid: ${PARAM_GRIDS.kellyMultiplier.length} x ${PARAM_GRIDS.edgeThreshold.length} = ${PARAM_GRIDS.kellyMultiplier.length * PARAM_GRIDS.edgeThreshold.length} configs`);
    console.log(`Seeds per config: ${NUM_SEEDS}`);
    console.log(`Total runs: ${PARAM_GRIDS.kellyMultiplier.length * PARAM_GRIDS.edgeThreshold.length * NUM_SEEDS}`);
    console.log('==================================================');

    const aggregatedResults: AggregatedResult[] = [];

    let configCount = 0;
    const totalConfigs = PARAM_GRIDS.kellyMultiplier.length * PARAM_GRIDS.edgeThreshold.length;

    for (const kelly of PARAM_GRIDS.kellyMultiplier) {
        for (const edge of PARAM_GRIDS.edgeThreshold) {
            configCount++;
            process.stdout.write(`\rConfig ${configCount}/${totalConfigs}: Kelly=${kelly}, Edge=${edge}... `);

            const seedResults: SeedResult[] = [];

            // Silence console logs during optimization
            const originalLog = console.log;
            console.log = () => {};

            try {
                for (const seed of SEEDS) {
                    // Set the seed for reproducibility
                    setSeed(seed);

                    const config: BacktestConfig = {
                        city: CITY,
                        days: DAYS,
                        initialBankroll: INITIAL_BANKROLL,
                        forecastConfig: FORECAST_CONFIG,
                        marketConfig: MARKET_CONFIG,
                        strategyConfig: {
                            kellyMultiplier: kelly,
                            edgeThreshold: edge
                        }
                    };

                    const metrics = await runBacktest(config);

                    seedResults.push({
                        seed,
                        totalPnL: metrics.totalPnL,
                        maxDrawdown: metrics.maxDrawdown,
                        winRate: metrics.winRate,
                        tradeCount: metrics.totalTrades
                    });

                    // Clear seed after each run
                    clearSeed();
                }

                // Aggregate results
                const pnls = seedResults.map(r => r.totalPnL);
                const drawdowns = seedResults.map(r => r.maxDrawdown);
                const trades = seedResults.map(r => r.tradeCount);

                const medPnL = median(pnls);
                const medDD = median(drawdowns);
                const calmar = medDD > 0 ? (medPnL / INITIAL_BANKROLL) / medDD : 0;

                aggregatedResults.push({
                    params: { kelly, edge },
                    medianPnL: medPnL,
                    p25PnL: percentile(pnls, 0.25),
                    worstPnL: Math.min(...pnls),
                    medianDrawdown: medDD,
                    worstDrawdown: Math.max(...drawdowns),
                    avgTradeCount: trades.reduce((a, b) => a + b, 0) / trades.length,
                    calmarRatio: calmar,
                    seedResults
                });

            } catch (err) {
                console.log = originalLog;
                console.error(chalk.red(`Config ${kelly}/${edge} failed: ${err}`));
            } finally {
                console.log = originalLog;
                clearSeed();
            }
        }
    }

    console.log(chalk.green('\n\n✅ Multi-Seed Optimization Complete!'));
    console.log('==================================================');

    // Sort by MEDIAN Calmar Ratio (robust metric)
    aggregatedResults.sort((a, b) => b.calmarRatio - a.calmarRatio);

    // Filter safe configs (WORST drawdown < 30%)
    const safeConfigs = aggregatedResults.filter(r => r.worstDrawdown < 0.30);

    console.log(chalk.bold.green('\n🛡️ Top Safe Configurations (Worst Drawdown < 30% across all seeds):'));
    if (safeConfigs.length > 0) {
        console.table(safeConfigs.slice(0, 5).map(r => ({
            Kelly: r.params.kelly,
            Edge: r.params.edge,
            'Median PnL': r.medianPnL.toFixed(2),
            'P25 PnL': r.p25PnL.toFixed(2),
            'Worst PnL': r.worstPnL.toFixed(2),
            'Median DD': (r.medianDrawdown * 100).toFixed(1) + '%',
            'Worst DD': (r.worstDrawdown * 100).toFixed(1) + '%',
            Calmar: r.calmarRatio.toFixed(2),
            'Avg Trades': r.avgTradeCount.toFixed(0)
        })));
    } else {
        console.log(chalk.yellow('No configurations met the <30% worst-case drawdown criteria.'));
        console.log(chalk.yellow('Try lowering Kelly or raising Edge threshold.'));
    }

    console.log(chalk.bold.yellow('\n🏆 Top Risk-Adjusted Configurations (All, by Median Calmar):'));
    console.table(aggregatedResults.slice(0, 5).map(r => ({
        Kelly: r.params.kelly,
        Edge: r.params.edge,
        'Median PnL': r.medianPnL.toFixed(2),
        'Median DD': (r.medianDrawdown * 100).toFixed(1) + '%',
        'Worst DD': (r.worstDrawdown * 100).toFixed(1) + '%',
        Calmar: r.calmarRatio.toFixed(2)
    })));

    console.log(chalk.bold.red('\n💩 Bottom 3 Configurations (by Median Calmar):'));
    console.table(aggregatedResults.slice(-3).map(r => ({
        Kelly: r.params.kelly,
        Edge: r.params.edge,
        'Median PnL': r.medianPnL.toFixed(2),
        'Worst PnL': r.worstPnL.toFixed(2),
        'Worst DD': (r.worstDrawdown * 100).toFixed(1) + '%',
        Calmar: r.calmarRatio.toFixed(2)
    })));

    // Show seed variance for top config
    if (aggregatedResults.length > 0) {
        const top = aggregatedResults[0];
        console.log(chalk.bold.cyan(`\n📊 Seed Variance for Top Config (Kelly=${top.params.kelly}, Edge=${top.params.edge}):`));
        console.table(top.seedResults.map(r => ({
            Seed: r.seed,
            PnL: r.totalPnL.toFixed(2),
            Drawdown: (r.maxDrawdown * 100).toFixed(1) + '%',
            WinRate: (r.winRate * 100).toFixed(1) + '%',
            Trades: r.tradeCount
        })));
    }
}

runOptimization().catch(console.error);
