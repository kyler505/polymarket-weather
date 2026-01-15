/**
 * Simulate Historical Performance Script
 * Backtests the probability engine and money management against historical data
 *
 * Usage: npm run simulate -- --city=NYC --days=30 [--mode=REAL]
 */

import chalk from 'chalk';
import { runBacktest, BacktestConfig } from '../simulation/backtestRunner';
import { findStationByName } from '../config/weatherConfig';

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

    const station = findStationByName(cityArg);
    if (!station) {
        console.error(chalk.red(`Error: Could not find station for city '${cityArg}'`));
        process.exit(1);
    }

    const config: BacktestConfig = {
        city: cityArg,
        days: daysArg,
        initialBankroll: INITIAL_BANKROLL,
        forecastConfig: {
            mode: modeArg as 'REAL' | 'SYNTHETIC',
            syntheticParams: {
                biasMean: 0,
                noiseScale: 1.0,
                useStudentT: false
            }
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

    try {
        const results = await runBacktest(config);

        console.log(chalk.cyan('\n================================='));
        console.log(chalk.bold('Backtest Results'));
        console.log(chalk.cyan('================================='));

        console.log(`Final Balance: $${results.finalBalance.toFixed(2)}`);
        console.log(`Total PnL:     $${results.totalPnL.toFixed(2)}`);
        console.log(`Win Rate:      ${(results.winRate * 100).toFixed(1)}%`);
        console.log(`Max Drawdown:  ${(results.maxDrawdown * 100).toFixed(2)}%`);
        console.log(`Brier Score:   ${results.avgBrier.toFixed(4)} (Lower is better)`);

    } catch (error) {
        console.error(chalk.red('Simulation failed:'), error);
    }
}

runSimulation().catch(console.error);
