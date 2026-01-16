/**
 * Simulate Historical Performance Script
 * Backtests the probability engine and money management against historical data
 *
 * Usage: npm run simulate -- --city=NYC --days=30 [--mode=REAL]
 */

import chalk from 'chalk';
import { runBacktest, BacktestConfig } from '../simulation/backtestRunner';
import { findStationByName } from '../config/weatherConfig';
import { clearSeed, setSeed } from '../simulation/forecastSimulator';

const DEFAULT_DAYS = 30;
const DEFAULT_CITY = 'NYC';
const INITIAL_BANKROLL = 1000;

async function runSimulation() {
    console.log(chalk.cyan.bold('🌤  Robust Historical Weather Simulation'));
    console.log(chalk.cyan('========================================'));

    // Parse args
    const args = process.argv.slice(2);
    const cityArg = args.find(a => a.startsWith('--city='))?.split('=')[1] || DEFAULT_CITY;
    const daysArg = parseInt(args.find(a => a.startsWith('--days='))?.split('=')[1] || String(DEFAULT_DAYS));

    const modeArg = args.find(a => a.startsWith('--mode='))?.split('=')[1] || 'SYNTHETIC';
    const kellyArg = parseFloat(args.find(a => a.startsWith('--kelly='))?.split('=')[1] || '0.25');
    const edgeArg = parseFloat(args.find(a => a.startsWith('--edge='))?.split('=')[1] || '0.02');
    const seedsArg = parseInt(args.find(a => a.startsWith('--seeds='))?.split('=')[1] || '1', 10);
    const seedBase = parseInt(args.find(a => a.startsWith('--seed-base='))?.split('=')[1] || '12345', 10);

    const station = findStationByName(cityArg);
    if (!station) {
        console.error(chalk.red(`Error: Could not find station for city '${cityArg}'`));
        process.exit(1);
    }

    const seeds = Array.from({ length: Math.max(seedsArg, 1) }, (_, i) => seedBase + i * 1000);

    const resultsBySeed: Array<ReturnType<typeof runBacktest> extends Promise<infer R> ? R : never> = [];

    try {
        for (const seed of seeds) {
            setSeed(seed);
            const config: BacktestConfig = {
                city: cityArg,
                days: daysArg,
                initialBankroll: INITIAL_BANKROLL,
                forecastConfig: {
                    mode: modeArg as 'REAL' | 'SYNTHETIC' | 'HYBRID_ML',
                    syntheticParams: {
                        biasMean: 0,
                        noiseScale: 1.0,
                        useStudentT: false
                    },
                    hybridParams: {
                        lookbackDays: 45,
                        minSamples: 20,
                        ridgeAlpha: 1.0,
                        knnK: 7,
                        calibrationSplit: 0.2,
                        clipDelta: 12,
                        sigmaFloor: 1.5,
                        seed
                    },
                    seed
                },
                marketConfig: {
                    vig: 0.05,        // 5% Vig
                    spread: 0.02,     // 2 cent spread
                    liquidity: 0.0001 // 1 cent impact per $10000
                },
                strategyConfig: {
                    kellyMultiplier: kellyArg,
                    edgeThreshold: edgeArg
                }
            };

            const results = await runBacktest(config);
            resultsBySeed.push(results);
            clearSeed();
        }

        const pnls = resultsBySeed.map(r => r.totalPnL);
        const drawdowns = resultsBySeed.map(r => r.maxDrawdown);
        const winRates = resultsBySeed.map(r => r.winRate);
        const brierScores = resultsBySeed.map(r => r.avgBrier);

        const median = (arr: number[]) => {
            const sorted = [...arr].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        };

        console.log(chalk.cyan('\n================================='));
        console.log(chalk.bold('Backtest Results'));
        console.log(chalk.cyan('================================='));

        if (seeds.length > 1) {
            console.log(`Seeds:         ${seeds.join(', ')}`);
            console.log(`Median PnL:    $${median(pnls).toFixed(2)}`);
            console.log(`Worst PnL:     $${Math.min(...pnls).toFixed(2)}`);
            console.log(`Median DD:     ${(median(drawdowns) * 100).toFixed(2)}%`);
            console.log(`Median Win:    ${(median(winRates) * 100).toFixed(1)}%`);
            console.log(`Median Brier:  ${median(brierScores).toFixed(4)}`);
        } else {
            const results = resultsBySeed[0];
            console.log(`Final Balance: $${results.finalBalance.toFixed(2)}`);
            console.log(`Total PnL:     $${results.totalPnL.toFixed(2)}`);
            console.log(`Win Rate:      ${(results.winRate * 100).toFixed(1)}%`);
            console.log(`Max Drawdown:  ${(results.maxDrawdown * 100).toFixed(2)}%`);
            console.log(`Brier Score:   ${results.avgBrier.toFixed(4)} (Lower is better)`);
        }

    } catch (error) {
        clearSeed();
        console.error(chalk.red('Simulation failed:'), error);
    }
}

runSimulation().catch(console.error);
