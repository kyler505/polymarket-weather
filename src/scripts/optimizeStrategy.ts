/**
 * Strategy Optimizer
 * Runs a grid search over strategy parameters to find the best configuration.
 *
 * Usage: npm run optimize
 */

import chalk from 'chalk';
import { runBacktest, BacktestConfig } from '../simulation/backtestRunner';
import { findStationByName } from '../config/weatherConfig';
import { ForecastConfig } from '../simulation/forecastSimulator';

// Optimization Configuration
const CITY = 'NYC';
const DAYS = 60; // Shorter period for speed, but enough for significance
const INITIAL_BANKROLL = 1000;

const PARAM_GRIDS = {
    kellyMultiplier: [0.05, 0.1, 0.15, 0.2, 0.25], // More conservative range
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

interface Result {
    params: { kelly: number, edge: number };
    totalPnL: number;
    finalBalance: number;
    winRate: number;
    maxDrawdown: number;
    tradeCount: number;
    calmarRatio: number; // Returns / Max Drawdown
}

async function runOptimization() {
    console.log(chalk.cyan.bold('🚀 Strategy Optimizer Starting...'));
    console.log(`Grid Search: ${PARAM_GRIDS.kellyMultiplier.length} x ${PARAM_GRIDS.edgeThreshold.length} = ${PARAM_GRIDS.kellyMultiplier.length * PARAM_GRIDS.edgeThreshold.length} runs`);
    console.log('==================================================');

    const results: Result[] = [];

    let count = 0;
    const totalRuns = PARAM_GRIDS.kellyMultiplier.length * PARAM_GRIDS.edgeThreshold.length;

    for (const kelly of PARAM_GRIDS.kellyMultiplier) {
        for (const edge of PARAM_GRIDS.edgeThreshold) {
            count++;
            process.stdout.write(`\rRun ${count}/${totalRuns}: Kelly=${kelly}, Edge=${edge}... `);

            // Silence console logs from the runner during optimization
            const originalLog = console.log;
            console.log = () => {};

            try {
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

                const calmar = metrics.maxDrawdown > 0 ? (metrics.totalPnL / config.initialBankroll) / metrics.maxDrawdown : 0;

                results.push({
                    params: { kelly, edge },
                    totalPnL: metrics.totalPnL,
                    finalBalance: metrics.finalBalance,
                    winRate: metrics.winRate,
                    maxDrawdown: metrics.maxDrawdown,
                    tradeCount: metrics.totalTrades,
                    calmarRatio: calmar
                });
            } catch (err) {
                // Restore log to print error
                console.log = originalLog;
                console.error(chalk.red(`Run failed: ${err}`));
            } finally {
                // Restore console.log
                console.log = originalLog;
            }
        }
    }

    console.log(chalk.green('\n\n✅ Optimization Complete!'));
    console.log('==================================================');

    // Sort by Calmar Ratio (Risk-Adjusted Return)
    results.sort((a, b) => b.calmarRatio - a.calmarRatio);

    const safeConfigs = results.filter(r => r.maxDrawdown < 0.30);
    const riskyConfigs = results.filter(r => r.maxDrawdown >= 0.30);

    console.log(chalk.bold.green('🛡️ Top Safe Configurations (Drawdown < 30%):'));
    if (safeConfigs.length > 0) {
        console.table(safeConfigs.slice(0, 5).map(r => ({
            Kelly: r.params.kelly,
            Edge: r.params.edge,
            PnL: r.totalPnL.toFixed(2),
            Drawdown: (r.maxDrawdown * 100).toFixed(1) + '%',
            Calmar: r.calmarRatio.toFixed(2),
            Trades: r.tradeCount
        })));
    } else {
        console.log(chalk.yellow('No configurations met the <30% drawdown safety criteria.'));
    }

    console.log(chalk.bold.yellow('\n🏆 Top Risk-Adjusted Configurations (All):'));
    console.table(results.slice(0, 5).map(r => ({
        Kelly: r.params.kelly,
        Edge: r.params.edge,
        PnL: r.totalPnL.toFixed(2),
        Drawdown: (r.maxDrawdown * 100).toFixed(1) + '%',
        Calmar: r.calmarRatio.toFixed(2),
        Trades: r.tradeCount
    })));

    console.log(chalk.bold.red('\n💩 Bottom 3 Configurations:'));
     console.table(results.slice(-3).map(r => ({
        Kelly: r.params.kelly,
        Edge: r.params.edge,
        PnL: r.totalPnL.toFixed(2),
        WinRate: (r.winRate * 100).toFixed(1) + '%',
        Drawdown: (r.maxDrawdown * 100).toFixed(1) + '%',
        Trades: r.tradeCount
    })));

}

runOptimization().catch(console.error);
