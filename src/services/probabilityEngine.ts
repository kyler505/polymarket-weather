/**
 * Probability Engine
 * Computes fair probabilities for weather market bins using forecast data
 */

import { WeatherMarket, WeatherBin, WeatherForecast, BinProbability } from '../interfaces/WeatherMarket';
import { getForecastSigma } from './weatherDataService';
import Logger from '../utils/logger';

/**
 * Standard Normal CDF using Abramowitz and Stegun approximation
 * More accurate than a simple approximation
 */
function normalCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1.0 + sign * y);
}

/**
 * Normal PDF for probability density
 */
function normalPDF(x: number, mean: number, sigma: number): number {
    const z = (x - mean) / sigma;
    return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

/**
 * Probability that X falls within [lower, upper] given Normal(mean, sigma)
 * Uses continuity correction for integer bins
 */
function probabilityInRange(
    mean: number,
    sigma: number,
    lower: number | null,
    upper: number | null,
    useContinuityCorrection: boolean = true
): number {
    const correction = useContinuityCorrection ? 0.5 : 0;

    if (lower === null && upper === null) {
        return 1.0; // Unbounded
    }

    if (lower === null) {
        // Floor bin: P(X <= upper)
        const z = ((upper! + correction) - mean) / sigma;
        return normalCDF(z);
    }

    if (upper === null) {
        // Ceiling bin: P(X >= lower)
        const z = ((lower - correction) - mean) / sigma;
        return 1 - normalCDF(z);
    }

    // Range bin: P(lower <= X <= upper)
    // For integer temperature, use continuity correction
    const zLower = ((lower - correction) - mean) / sigma;
    const zUpper = ((upper + correction) - mean) / sigma;
    return normalCDF(zUpper) - normalCDF(zLower);
}

/**
 * Compute probabilities for all bins given a forecast
 */
export function computeBinProbabilities(
    forecast: WeatherForecast,
    bins: WeatherBin[],
    metric: 'DAILY_MAX_TEMP' | 'DAILY_MIN_TEMP' | 'RAINFALL' | 'SNOWFALL',
    maxSoFar?: number
): Map<string, number> {
    const probabilities = new Map<string, number>();

    // Get the forecast value based on metric
    let forecastValue: number | undefined;
    if (metric === 'DAILY_MAX_TEMP') {
        forecastValue = forecast.forecastHigh;
    } else if (metric === 'DAILY_MIN_TEMP') {
        forecastValue = forecast.forecastLow;
    }

    if (forecastValue === undefined) {
        Logger.warning(`No forecast value for metric ${metric}`);
        // Return uniform probabilities as fallback
        const uniformProb = 1 / bins.length;
        for (const bin of bins) {
            probabilities.set(bin.tokenId, uniformProb);
        }
        return probabilities;
    }

    // Get sigma based on lead time
    const sigma = getForecastSigma(forecast.leadDays);

    // First pass: compute raw probabilities
    const rawProbs = new Map<string, number>();
    let totalProb = 0;

    for (const bin of bins) {
        let prob: number;

        // Check if this bin is still possible given maxSoFar
        if (maxSoFar !== undefined && metric === 'DAILY_MAX_TEMP') {
            // If we've already exceeded the bin's upper bound, it's impossible
            if (bin.upperBound !== null && maxSoFar > bin.upperBound && !bin.isCeiling) {
                prob = 0;
            } else if (bin.isFloor && maxSoFar > (bin.upperBound || 0)) {
                // Floor bin is impossible if we've exceeded it
                prob = 0;
            } else {
                // Condition the distribution on X >= maxSoFar
                // P(bin | X >= maxSoFar) = P(bin ∩ X >= maxSoFar) / P(X >= maxSoFar)
                const conditionedLower = Math.max(bin.lowerBound || -Infinity, maxSoFar);

                if (bin.isCeiling || (bin.upperBound !== null && conditionedLower <= bin.upperBound)) {
                    prob = probabilityInRange(forecastValue, sigma, conditionedLower, bin.upperBound);
                } else {
                    prob = 0;
                }
            }
        } else {
            // Standard probability calculation
            prob = probabilityInRange(forecastValue, sigma, bin.lowerBound, bin.upperBound);
        }

        rawProbs.set(bin.tokenId, prob);
        totalProb += prob;
    }

    // Normalize to ensure probabilities sum to 1
    if (totalProb > 0) {
        for (const [tokenId, prob] of rawProbs) {
            probabilities.set(tokenId, prob / totalProb);
        }
    } else {
        // Edge case: all bins have 0 probability (shouldn't happen normally)
        const uniformProb = 1 / bins.length;
        for (const bin of bins) {
            probabilities.set(bin.tokenId, uniformProb);
        }
    }

    return probabilities;
}

/**
 * Compute full bin probability analysis with edge calculations
 */
export function analyzeBinProbabilities(
    market: WeatherMarket,
    forecast: WeatherForecast,
    marketPrices: Map<string, number>,
    maxSoFar?: number
): BinProbability[] {
    const fairProbs = computeBinProbabilities(forecast, market.bins, market.metric, maxSoFar);
    const results: BinProbability[] = [];

    for (const bin of market.bins) {
        const fairProbability = fairProbs.get(bin.tokenId) || 0;
        const marketPrice = marketPrices.get(bin.tokenId) || 0.5;
        const edge = fairProbability - marketPrice;

        // Determine if bin is still possible
        let isPossible = true;
        if (maxSoFar !== undefined && market.metric === 'DAILY_MAX_TEMP') {
            if (bin.upperBound !== null && maxSoFar > bin.upperBound && !bin.isCeiling) {
                isPossible = false;
            }
            if (bin.isFloor && maxSoFar > (bin.upperBound || 0)) {
                isPossible = false;
            }
        }

        results.push({
            outcomeId: bin.outcomeId,
            label: bin.label,
            fairProbability,
            marketPrice,
            edge,
            isPossible,
        });
    }

    return results;
}

/**
 * Get the expected value of the temperature given constraints
 */
export function getExpectedValue(
    forecastValue: number,
    sigma: number,
    minValue?: number
): number {
    if (minValue === undefined) {
        return forecastValue;
    }

    // Conditional expectation E[X | X >= minValue]
    // For truncated normal: E[X | X >= a] = μ + σ * φ(α) / (1 - Φ(α))
    // where α = (a - μ) / σ
    const alpha = (minValue - forecastValue) / sigma;
    const phi = normalPDF(alpha, 0, 1);
    const Phi = normalCDF(-alpha); // = 1 - normalCDF(alpha)

    if (Phi < 0.0001) {
        // If almost certainly above minValue, expected value is near minValue
        return minValue;
    }

    return forecastValue + sigma * phi / Phi;
}

/**
 * Calculate Kelly criterion position size
 * Returns optimal fraction of capital to bet
 */
export function kellyFraction(
    fairProbability: number,
    marketPrice: number,
    maxFraction: number = 0.05 // Conservative default (5% of capital) for production safety
): number {
    if (fairProbability <= 0 || fairProbability >= 1) return 0;
    if (marketPrice <= 0 || marketPrice >= 1) return 0;

    // For buying YES at price p with fair prob f:
    // Kelly = (f * (1-p) - (1-f) * p) / (1-p) = (f - p) / (1 - p)
    const edge = fairProbability - marketPrice;
    if (edge <= 0) return 0; // No edge, no bet

    const oddsRatio = 1 / marketPrice - 1; // Odds of winning
    const kelly = (fairProbability * oddsRatio - (1 - fairProbability)) / oddsRatio;

    // Cap the Kelly fraction
    return Math.max(0, Math.min(kelly, maxFraction));
}

/**
 * Determine if we should trade based on edge and confidence
 */
export function shouldTrade(
    edge: number,
    edgeThreshold: number,
    fairProbability: number,
    isPossible: boolean
): { shouldTrade: boolean; side: 'BUY' | 'SELL'; reason: string } {
    if (!isPossible) {
        // If bin is impossible, we might want to sell if we hold
        return { shouldTrade: false, side: 'SELL', reason: 'Bin impossible' };
    }

    if (edge > edgeThreshold) {
        return { shouldTrade: true, side: 'BUY', reason: `Edge ${(edge * 100).toFixed(1)}% > threshold` };
    }

    if (edge < -edgeThreshold) {
        return { shouldTrade: true, side: 'SELL', reason: `Negative edge ${(edge * 100).toFixed(1)}%` };
    }

    return { shouldTrade: false, side: 'BUY', reason: 'Edge below threshold' };
}

export default {
    computeBinProbabilities,
    analyzeBinProbabilities,
    getExpectedValue,
    kellyFraction,
    shouldTrade,
    normalCDF,
};
