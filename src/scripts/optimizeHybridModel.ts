/**
 * Hybrid ML Optimizer
 * Runs a grid search over hybrid model parameters with multiple seeds.
 *
 * Usage:
 *   npm run optimize-hybrid -- --city=NYC --days=60 --seeds=5 --kelly=0.05 --edge=0.12
 */

import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { runBacktest, BacktestConfig } from '../simulation/backtestRunner';
import { findStationByName } from '../config/weatherConfig';
import { clearSeed, setSeed } from '../simulation/forecastSimulator';

const DEFAULT_CITY = 'NYC';
const DEFAULT_DAYS = 60;
const INITIAL_BANKROLL = 1000;

type HybridParamConfig = {
    lookbackDays: number;
    minSamples: number;
    ridgeAlpha: number;
    knnK: number;
    calibrationSplit: number;
    clipDelta: number;
    sigmaFloor: number;
};

type SeedResult = {
    seed: number;
    totalPnL: number;
    maxDrawdown: number;
    winRate: number;
    tradeCount: number;
    avgBrier: number;
};

type AggregatedResult = {
    params: HybridParamConfig;
    medianPnL: number;
    p25PnL: number;
    worstPnL: number;
    medianDrawdown: number;
    worstDrawdown: number;
    medianWinRate: number;
    medianBrier: number;
    avgTradeCount: number;
    calmarRatio: number;
    seedResults: SeedResult[];
};

const parseArg = (key: string): string | undefined => {
    const prefix = `--${key}=`;
    return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
};

const parseNumber = (key: string, fallback: number): number => {
    const raw = parseArg(key);
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
};

const parseNumberList = (key: string, fallback: number[]): number[] => {
    const raw = parseArg(key);
    if (!raw) return fallback;
    return raw
        .split(',')
        .map(val => Number(val.trim()))
        .filter(val => Number.isFinite(val));
};

const median = (values: number[]): number => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const percentile = (values: number[], p: number): number => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * p);
    return sorted[Math.min(idx, sorted.length - 1)];
};

const seededShuffle = <T>(items: T[], seed: number): T[] => {
    let s = seed;
    const random = () => {
        s = (s * 1664525 + 1013904223) % 4294967296;
        return s / 4294967296;
    };
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
};

const buildGrid = (params: {
    lookbackDays: number[];
    minSamples: number[];
    ridgeAlpha: number[];
    knnK: number[];
    calibrationSplit: number[];
    clipDelta: number[];
    sigmaFloor: number[];
}): HybridParamConfig[] => {
    const grid: HybridParamConfig[] = [];
    for (const lookbackDays of params.lookbackDays) {
        for (const minSamples of params.minSamples) {
            for (const ridgeAlpha of params.ridgeAlpha) {
                for (const knnK of params.knnK) {
                    for (const calibrationSplit of params.calibrationSplit) {
                        for (const clipDelta of params.clipDelta) {
                            for (const sigmaFloor of params.sigmaFloor) {
                                grid.push({
                                    lookbackDays,
                                    minSamples,
                                    ridgeAlpha,
                                    knnK,
                                    calibrationSplit,
                                    clipDelta,
                                    sigmaFloor,
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    return grid;
};

const formatEnvSnippet = (params: HybridParamConfig): string[] => {
    return [
        'WEATHER_ML_ENABLED=true',
        `WEATHER_ML_LOOKBACK_DAYS=${params.lookbackDays}`,
        `WEATHER_ML_MIN_SAMPLES=${params.minSamples}`,
        `WEATHER_ML_RIDGE_ALPHA=${params.ridgeAlpha}`,
        `WEATHER_ML_KNN_K=${params.knnK}`,
        `WEATHER_ML_CALIBRATION_SPLIT=${params.calibrationSplit}`,
        `WEATHER_ML_CLIP_DELTA=${params.clipDelta}`,
        `WEATHER_ML_SIGMA_FLOOR=${params.sigmaFloor}`,
    ];
};

async function runOptimization() {
    const city = parseArg('city') || DEFAULT_CITY;
    const days = parseNumber('days', DEFAULT_DAYS);
    const seedsCount = Math.max(1, Math.floor(parseNumber('seeds', 5)));
    const seedBase = parseNumber('seed-base', 12345);
    const kellyMultiplier = parseNumber('kelly', 0.05);
    const edgeThreshold = parseNumber('edge', 0.12);
    const maxDrawdown = parseNumber('max-dd', 0.3);
    const maxConfigs = Math.max(0, Math.floor(parseNumber('max-configs', 0)));
    const outputPath = parseArg('output') || path.join(process.cwd(), 'hybrid-ml-optimization.json');
    const envOutput = parseArg('write-env');

    const station = findStationByName(city);
    if (!station) {
        console.error(chalk.red(`Error: Could not find station for city '${city}'`));
        process.exit(1);
    }

    const gridParams = {
        lookbackDays: parseNumberList('lookback-days', [30, 45, 60, 90]),
        minSamples: parseNumberList('min-samples', [15, 25, 35]),
        ridgeAlpha: parseNumberList('ridge-alpha', [0.5, 1.0, 2.0]),
        knnK: parseNumberList('knn-k', [5, 7, 11]),
        calibrationSplit: parseNumberList('calibration-split', [0.2, 0.3]),
        clipDelta: parseNumberList('clip-delta', [8, 12, 16]),
        sigmaFloor: parseNumberList('sigma-floor', [1.5, 2.0]),
    };

    const seeds = Array.from({ length: seedsCount }, (_, i) => seedBase + i * 1000);
    let grid = buildGrid(gridParams);
    if (maxConfigs > 0 && maxConfigs < grid.length) {
        grid = seededShuffle(grid, seedBase).slice(0, maxConfigs);
    }

    console.log(chalk.cyan.bold('🧠 Hybrid ML Optimizer'));
    console.log(chalk.cyan('========================================'));
    console.log(`City: ${city} | Days: ${days} | Seeds: ${seeds.join(', ')}`);
    console.log(`Kelly: ${kellyMultiplier} | Edge: ${edgeThreshold}`);
    console.log(`Configs: ${grid.length} | Max DD: ${(maxDrawdown * 100).toFixed(1)}%`);

    const aggregatedResults: AggregatedResult[] = [];
    let configIndex = 0;

    for (const params of grid) {
        configIndex++;
        process.stdout.write(
            `\rConfig ${configIndex}/${grid.length} | lookback=${params.lookbackDays} knn=${params.knnK} ridge=${params.ridgeAlpha}... `
        );

        const seedResults: SeedResult[] = [];
        const originalLog = console.log;
        console.log = () => {};

        try {
            for (const seed of seeds) {
                setSeed(seed);
                const config: BacktestConfig = {
                    city,
                    days,
                    initialBankroll: INITIAL_BANKROLL,
                    forecastConfig: {
                        mode: 'HYBRID_ML',
                        syntheticParams: {
                            biasMean: 0,
                            noiseScale: 1.0,
                            useStudentT: false,
                        },
                        hybridParams: {
                            lookbackDays: params.lookbackDays,
                            minSamples: params.minSamples,
                            ridgeAlpha: params.ridgeAlpha,
                            knnK: params.knnK,
                            calibrationSplit: params.calibrationSplit,
                            clipDelta: params.clipDelta,
                            sigmaFloor: params.sigmaFloor,
                            seed,
                        },
                        seed,
                    },
                    marketConfig: {
                        vig: 0.05,
                        spread: 0.02,
                        liquidity: 0.0001,
                    },
                    strategyConfig: {
                        kellyMultiplier,
                        edgeThreshold,
                    },
                };

                const metrics = await runBacktest(config);
                seedResults.push({
                    seed,
                    totalPnL: metrics.totalPnL,
                    maxDrawdown: metrics.maxDrawdown,
                    winRate: metrics.winRate,
                    tradeCount: metrics.totalTrades,
                    avgBrier: metrics.avgBrier,
                });
                clearSeed();
            }
        } catch (error) {
            clearSeed();
        } finally {
            console.log = originalLog;
        }

        if (seedResults.length === 0) {
            continue;
        }

        const pnls = seedResults.map(r => r.totalPnL);
        const drawdowns = seedResults.map(r => r.maxDrawdown);
        const wins = seedResults.map(r => r.winRate);
        const trades = seedResults.map(r => r.tradeCount);
        const briers = seedResults.map(r => r.avgBrier);

        const medPnL = median(pnls);
        const medDD = median(drawdowns);
        const calmarRatio = medDD > 0 ? (medPnL / INITIAL_BANKROLL) / medDD : 0;

        aggregatedResults.push({
            params,
            medianPnL: medPnL,
            p25PnL: percentile(pnls, 0.25),
            worstPnL: Math.min(...pnls),
            medianDrawdown: medDD,
            worstDrawdown: Math.max(...drawdowns),
            medianWinRate: median(wins),
            medianBrier: median(briers),
            avgTradeCount: trades.reduce((sum, value) => sum + value, 0) / trades.length,
            calmarRatio,
            seedResults,
        });
    }

    console.log('\n');
    if (aggregatedResults.length === 0) {
        console.log(chalk.red('No successful configs. Try reducing grid size or seeds.'));
        return;
    }

    const sorted = [...aggregatedResults].sort((a, b) => b.calmarRatio - a.calmarRatio);
    const safeConfigs = sorted.filter(result => result.worstDrawdown <= maxDrawdown);
    const best = safeConfigs[0] || sorted[0];

    console.log(chalk.green('✅ Optimization complete'));
    console.log('Top config summary:');
    console.table([{
        Lookback: best.params.lookbackDays,
        MinSamples: best.params.minSamples,
        Ridge: best.params.ridgeAlpha,
        kNN: best.params.knnK,
        CalSplit: best.params.calibrationSplit,
        Clip: best.params.clipDelta,
        SigmaFloor: best.params.sigmaFloor,
        'Median PnL': best.medianPnL.toFixed(2),
        'Worst PnL': best.worstPnL.toFixed(2),
        'Median DD': `${(best.medianDrawdown * 100).toFixed(1)}%`,
        'Worst DD': `${(best.worstDrawdown * 100).toFixed(1)}%`,
        Calmar: best.calmarRatio.toFixed(2),
        Trades: best.avgTradeCount.toFixed(0),
        'Median Brier': best.medianBrier.toFixed(4),
    }]);

    const envSnippet = formatEnvSnippet(best.params);
    console.log(chalk.cyan('\nRecommended .env snippet:'));
    envSnippet.forEach(line => console.log(line));

    const output = {
        metadata: {
            city,
            days,
            seeds,
            kellyMultiplier,
            edgeThreshold,
            maxDrawdown,
            totalConfigs: grid.length,
            evaluatedConfigs: aggregatedResults.length,
        },
        best,
        topConfigs: sorted.slice(0, 10),
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(chalk.gray(`\nSaved results to ${outputPath}`));

    if (envOutput) {
        fs.writeFileSync(envOutput, envSnippet.join('\n') + '\n');
        console.log(chalk.gray(`Saved env snippet to ${envOutput}`));
    }
}

runOptimization().catch(error => {
    clearSeed();
    console.error(chalk.red('Optimization failed:'), error);
    process.exit(1);
});
