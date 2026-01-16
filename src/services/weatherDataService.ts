/**
 * Weather Data Service
 * Fetches weather forecasts and observations from multiple sources
 */

import axios from 'axios';
import { WeatherForecast, WeatherObservation } from '../interfaces/WeatherMarket';
import { getStation, getSigmaForLeadDays, WEATHER_API } from '../config/weatherConfig';
import Logger from '../utils/logger';
import {
    buildHybridFeatures,
    createHybridForecast,
    HybridModelConfig,
    HybridModelRuntimeConfig,
    HybridTrainingSample,
    runHybridModel,
} from '../utils/hybridModel';

// Cache for forecasts to reduce API calls
const forecastCache = new Map<string, { forecast: WeatherForecast; cachedAt: Date }>();
const historicalForecastCache = new Map<string, { forecast: WeatherForecast; cachedAt: Date }>();
const hybridForecastCache = new Map<string, { forecast: WeatherForecast; cachedAt: Date }>();
const trainingDataCache = new Map<string, { data: HybridTrainingSample[]; cachedAt: Date }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const HISTORICAL_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const HYBRID_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const TRAINING_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const dailyCache = new Map<string, { maxTemp: number; minTemp: number }>();

const getLeadDays = (targetDate: string): number => {
    const now = new Date();
    const target = new Date(targetDate);
    const leadDays = Math.ceil((target.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    return Math.max(0, leadDays);
};

const average = (values: Array<number | undefined>): number | undefined => {
    const filtered = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (filtered.length === 0) return undefined;
    return filtered.reduce((sum, v) => sum + v, 0) / filtered.length;
};

const calculateSpread = (values: Array<number | undefined>): number => {
    const filtered = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (filtered.length < 2) return 0;
    return Math.max(...filtered) - Math.min(...filtered);
};

/**
 * Get forecast from NOAA/NWS API
 */
async function fetchNOAAForecast(lat: number, lon: number, targetDate: string): Promise<WeatherForecast | null> {
    try {
        // Step 1: Get the forecast grid endpoint for this location
        const pointsUrl = `${WEATHER_API.NOAA_FORECAST}/${lat.toFixed(4)},${lon.toFixed(4)}`;
        const pointsResponse = await axios.get(pointsUrl, {
            headers: { 'User-Agent': 'WeatherTradingBot/1.0' },
            timeout: 10000,
        });

        const forecastUrl = pointsResponse.data.properties?.forecast;
        if (!forecastUrl) {
            Logger.warning('NOAA: No forecast URL in points response');
            return null;
        }

        // Step 2: Get the actual forecast
        const forecastResponse = await axios.get(forecastUrl, {
            headers: { 'User-Agent': 'WeatherTradingBot/1.0' },
            timeout: 10000,
        });

        const periods = forecastResponse.data.properties?.periods;
        if (!periods || periods.length === 0) {
            Logger.warning('NOAA: No forecast periods returned');
            return null;
        }

        // Find the period matching our target date
        const targetDateObj = new Date(targetDate);
        let highTemp: number | undefined;
        let lowTemp: number | undefined;

        for (const period of periods) {
            const periodDate = new Date(period.startTime).toISOString().split('T')[0];
            if (periodDate === targetDate) {
                const temp = period.temperature;
                if (period.isDaytime) {
                    highTemp = temp;
                } else {
                    lowTemp = temp;
                }
            }
        }

        if (highTemp === undefined && lowTemp === undefined) {
            Logger.warning(`NOAA: No forecast found for ${targetDate}`);
            return null;
        }

        // Calculate lead days
        const leadDays = getLeadDays(targetDate);

        return {
            stationId: '', // Will be filled by caller
            targetDate,
            forecastHigh: highTemp,
            forecastLow: lowTemp,
            source: 'NOAA',
            retrievedAt: new Date(),
            leadDays: Math.max(0, leadDays),
        };
    } catch (error) {
        Logger.warning(`NOAA forecast fetch failed: ${error}`);
        return null;
    }
}

/**
 * Get forecast from Open-Meteo API (free, no API key required)
 */
async function fetchOpenMeteoForecast(lat: number, lon: number, targetDate: string): Promise<WeatherForecast | null> {
    try {
        const url = `${WEATHER_API.OPEN_METEO}?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&start_date=${targetDate}&end_date=${targetDate}`;

        const response = await axios.get(url, { timeout: 10000 });

        const daily = response.data.daily;
        if (!daily || !daily.time || daily.time.length === 0) {
            Logger.warning('Open-Meteo: No daily data returned');
            return null;
        }

        const idx = daily.time.indexOf(targetDate);
        if (idx === -1) {
            Logger.warning(`Open-Meteo: Target date ${targetDate} not in response`);
            return null;
        }

        const leadDays = getLeadDays(targetDate);

        return {
            stationId: '',
            targetDate,
            forecastHigh: daily.temperature_2m_max?.[idx],
            forecastLow: daily.temperature_2m_min?.[idx],
            source: 'Open-Meteo',
            retrievedAt: new Date(),
            leadDays: Math.max(0, leadDays),
        };
    } catch (error) {
        Logger.warning(`Open-Meteo forecast fetch failed: ${error}`);
        return null;
    }
}

type ForecastSources = {
    noaa?: WeatherForecast | null;
    openMeteo?: WeatherForecast | null;
};

const buildEnsembleForecast = (
    stationId: string,
    targetDate: string,
    forecasts: WeatherForecast[]
): WeatherForecast | null => {
    if (forecasts.length === 0) return null;

    const leadDays = forecasts[0].leadDays ?? getLeadDays(targetDate);
    const forecastHigh = average(forecasts.map(f => f.forecastHigh));
    const forecastLow = average(forecasts.map(f => f.forecastLow));
    const highSpread = calculateSpread(forecasts.map(f => f.forecastHigh));
    const lowSpread = calculateSpread(forecasts.map(f => f.forecastLow));

    const baseSigma = getForecastSigma(leadDays);
    const sigmaHigh = baseSigma + highSpread * 0.35;
    const sigmaLow = baseSigma + lowSpread * 0.35;

    return {
        stationId,
        targetDate,
        forecastHigh,
        forecastLow,
        source: forecasts.length > 1
            ? `Ensemble(${forecasts.map(f => f.source).join('+')})`
            : forecasts[0].source,
        retrievedAt: new Date(),
        leadDays,
        sigmaHigh,
        sigmaLow,
    };
};

async function getForecastSources(stationId: string, targetDate: string): Promise<ForecastSources> {
    const station = getStation(stationId);
    if (!station) return {};

    const [noaa, openMeteo] = await Promise.all([
        fetchNOAAForecast(station.lat, station.lon, targetDate),
        fetchOpenMeteoForecast(station.lat, station.lon, targetDate),
    ]);

    if (noaa) noaa.stationId = stationId;
    if (openMeteo) openMeteo.stationId = stationId;

    return { noaa, openMeteo };
}

/**
 * Get forecast for a station, trying multiple sources
 */
export async function getForecast(stationId: string, targetDate: string): Promise<WeatherForecast | null> {
    const cacheKey = `${stationId}:${targetDate}`;

    // Check cache
    const cached = forecastCache.get(cacheKey);
    if (cached && (Date.now() - cached.cachedAt.getTime()) < CACHE_TTL_MS) {
        return cached.forecast;
    }

    const station = getStation(stationId);
    if (!station) {
        Logger.warning(`Unknown station: ${stationId}`);
        return null;
    }

    // Try NOAA first
    let forecast = await fetchNOAAForecast(station.lat, station.lon, targetDate);

    // Fallback to Open-Meteo
    if (!forecast) {
        forecast = await fetchOpenMeteoForecast(station.lat, station.lon, targetDate);
    }

    if (forecast) {
        forecast.stationId = stationId;
        const sigma = getForecastSigma(forecast.leadDays);
        forecast.sigmaHigh = sigma;
        forecast.sigmaLow = sigma;
        forecastCache.set(cacheKey, { forecast, cachedAt: new Date() });
    }

    return forecast;
}

/**
 * Get ensemble forecast (combines multiple sources with weighted average)
 */
export async function getEnsembleForecast(stationId: string, targetDate: string): Promise<WeatherForecast | null> {
    const sources = await getForecastSources(stationId, targetDate);
    const forecasts = [sources.noaa, sources.openMeteo].filter(
        (forecast): forecast is WeatherForecast => Boolean(forecast)
    );

    return buildEnsembleForecast(stationId, targetDate, forecasts);
}

async function fetchOpenMeteoHistoricalForecast(
    lat: number,
    lon: number,
    targetDate: string,
    leadDays: number
): Promise<WeatherForecast | null> {
    try {
        const url = `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&start_date=${targetDate}&end_date=${targetDate}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto`;
        const response = await axios.get(url, { timeout: 10000 });
        const daily = response.data.daily;
        if (!daily || !daily.temperature_2m_max || daily.temperature_2m_max.length === 0) {
            return null;
        }

        const sigma = getForecastSigma(leadDays);
        return {
            stationId: '',
            targetDate,
            forecastHigh: daily.temperature_2m_max[0],
            forecastLow: daily.temperature_2m_min[0],
            source: 'Open-Meteo-Hist-Forecast',
            retrievedAt: new Date(),
            leadDays,
            sigmaHigh: sigma,
            sigmaLow: sigma,
        };
    } catch (error) {
        Logger.warning(`Historical forecast fetch failed: ${error}`);
        return null;
    }
}

export async function getHistoricalForecast(
    stationId: string,
    targetDate: string,
    leadDays: number
): Promise<WeatherForecast | null> {
    const cacheKey = `${stationId}:${targetDate}:${leadDays}`;
    const cached = historicalForecastCache.get(cacheKey);
    if (cached && (Date.now() - cached.cachedAt.getTime()) < HISTORICAL_CACHE_TTL_MS) {
        return cached.forecast;
    }

    const station = getStation(stationId);
    if (!station) return null;

    const forecast = await fetchOpenMeteoHistoricalForecast(station.lat, station.lon, targetDate, leadDays);
    if (forecast) {
        forecast.stationId = stationId;
        historicalForecastCache.set(cacheKey, { forecast, cachedAt: new Date() });
    }

    return forecast;
}

/**
 * Scrape current observation from Weather Underground
 * Note: This is a simplified version - in production, you'd want proper HTML parsing
 */
export async function getCurrentObservation(stationId: string): Promise<WeatherObservation | null> {
    const station = getStation(stationId);
    if (!station) return null;

    try {
        // For now, use Open-Meteo current weather as a proxy
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${station.lat}&longitude=${station.lon}&current=temperature_2m&temperature_unit=fahrenheit`;

        const response = await axios.get(url, { timeout: 10000 });

        const current = response.data.current;
        if (!current) return null;

        return {
            stationId,
            timestamp: new Date(current.time),
            temperature: current.temperature_2m,
            source: 'Open-Meteo-Current',
        };
    } catch (error) {
        Logger.warning(`Current observation fetch failed for ${stationId}: ${error}`);
        return null;
    }
}

/**
 * Get the maximum temperature observed so far today for a station
 * This is critical for day-of probability conditioning
 */
export async function getDailyMaxSoFar(stationId: string): Promise<number | null> {
    const station = getStation(stationId);
    if (!station) return null;

    try {
        // Use Open-Meteo hourly data for today
        const today = new Date().toISOString().split('T')[0];
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${station.lat}&longitude=${station.lon}&hourly=temperature_2m&temperature_unit=fahrenheit&start_date=${today}&end_date=${today}&timezone=auto`;

        const response = await axios.get(url, { timeout: 10000 });

        const hourly = response.data.hourly;
        if (!hourly || !hourly.temperature_2m) return null;

        // Get local hour to know how much of the day has passed
        const now = new Date();
        const localHour = now.getHours();

        // Only consider hours that have already occurred
        const temps = hourly.temperature_2m.slice(0, localHour + 1);
        if (temps.length === 0) return null;

        // Return the maximum
        return Math.max(...temps.filter((t: number | null) => t !== null));
    } catch (error) {
        Logger.warning(`Daily max fetch failed for ${stationId}: ${error}`);
        return null;
    }
}

/**
 * Get sigma (standard deviation) for probability calculations
 */
export function getForecastSigma(leadDays: number): number {
    return getSigmaForLeadDays(leadDays);
}

/**
 * Get historical daily data (validation/actuals)
 */
export async function getHistoricalDailyData(stationId: string, date: string): Promise<{ maxTemp: number; minTemp: number } | null> {
    const station = getStation(stationId);
    if (!station) return null;

    const cacheKey = `${stationId}:${date}`;
    if (dailyCache.has(cacheKey)) {
        return dailyCache.get(cacheKey) || null;
    }

    try {
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${station.lat}&longitude=${station.lon}&start_date=${date}&end_date=${date}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto`;

        const response = await axios.get(url, { timeout: 10000 });
        const daily = response.data.daily;

        if (!daily || !daily.temperature_2m_max || daily.temperature_2m_max.length === 0) {
            return null;
        }

        const result = {
            maxTemp: daily.temperature_2m_max[0],
            minTemp: daily.temperature_2m_min[0],
        };
        dailyCache.set(cacheKey, result);
        return result;
    } catch (error) {
        Logger.warning(`Historical data fetch failed for ${stationId}: ${error}`);
        return null;
    }
}

/**
 * Simulate a forecast by adding noise to the actual value
 * Used for backtesting when real historical forecasts are not available
 */
export function simulateForecast(
    actualInfo: { maxTemp: number; minTemp: number },
    targetDate: string,
    leadDays: number
): WeatherForecast {
    // Get typical error sigma for this lead time
    const sigma = getForecastSigma(leadDays);

    // Add Gaussian noise (Box-Muller transform)
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const error = z * sigma;

    // Simulate forecast bias (optional, usually forecasts slightly under-predict extremes)
    // For now, assume unbiased but noisy
    const forecastHigh = actualInfo.maxTemp + error;
    const forecastLow = actualInfo.minTemp + error;

    return {
        stationId: '',
        targetDate,
        forecastHigh: Number(forecastHigh.toFixed(1)),
        forecastLow: Number(forecastLow.toFixed(1)),
        source: 'Simulated(Actual+Noise)',
        retrievedAt: new Date(),
        leadDays,
        sigmaHigh: sigma,
        sigmaLow: sigma,
    };
}

export interface HybridForecastOptions {
    mlEnabled: boolean;
    lookbackDays: number;
    minSamples: number;
    allowSimulatedTraining: boolean;
    runtime: HybridModelRuntimeConfig;
    modelConfig: HybridModelConfig;
    cacheTtlMs: number;
    trainingCacheTtlMs: number;
}

const DEFAULT_HYBRID_OPTIONS: HybridForecastOptions = {
    mlEnabled: false,
    lookbackDays: 60,
    minSamples: 25,
    allowSimulatedTraining: false,
    runtime: {
        pythonPath: 'python3',
        timeoutMs: 15000,
    },
    modelConfig: {
        ridge_alpha: 1.0,
        knn_k: 7,
        min_samples: 25,
        calibration_split: 0.2,
        clip_delta: 12,
        sigma_floor: 1.5,
    },
    cacheTtlMs: HYBRID_CACHE_TTL_MS,
    trainingCacheTtlMs: TRAINING_CACHE_TTL_MS,
};

const buildHybridTrainingData = async (
    stationId: string,
    lookbackDays: number,
    leadDays: number,
    allowSimulatedTraining: boolean,
    trainingCacheTtlMs: number
): Promise<HybridTrainingSample[]> => {
    const cacheKey = `${stationId}:${lookbackDays}:${leadDays}:${allowSimulatedTraining ? 'sim' : 'nosim'}`;
    const cached = trainingDataCache.get(cacheKey);
    if (cached && (Date.now() - cached.cachedAt.getTime()) < trainingCacheTtlMs) {
        return cached.data;
    }

    const station = getStation(stationId);
    if (!station) return [];

    const samples: HybridTrainingSample[] = [];
    const today = new Date();

    for (let i = 1; i <= lookbackDays; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        const actuals = await getHistoricalDailyData(stationId, dateStr);
        if (!actuals) continue;

        let forecast = await getHistoricalForecast(stationId, dateStr, leadDays);
        if (!forecast && allowSimulatedTraining) {
            forecast = simulateForecast({ maxTemp: actuals.maxTemp, minTemp: actuals.minTemp }, dateStr, leadDays);
            forecast.source = 'SimulatedTraining';
        }

        if (!forecast || forecast.forecastHigh === undefined || forecast.forecastLow === undefined) {
            continue;
        }

        forecast.stationId = stationId;

        const features = buildHybridFeatures({
            station,
            date,
            leadDays,
            ensemble: forecast,
            openMeteo: forecast,
        });

        samples.push({
            date: dateStr,
            features,
            target_high: actuals.maxTemp,
            target_low: actuals.minTemp,
        });
    }

    trainingDataCache.set(cacheKey, { data: samples, cachedAt: new Date() });
    return samples;
};

export async function getHybridForecast(
    stationId: string,
    targetDate: string,
    options: Partial<HybridForecastOptions> = {}
): Promise<WeatherForecast | null> {
    const mergedOptions: HybridForecastOptions = {
        ...DEFAULT_HYBRID_OPTIONS,
        ...options,
        runtime: {
            ...DEFAULT_HYBRID_OPTIONS.runtime,
            ...options.runtime,
        },
        modelConfig: {
            ...DEFAULT_HYBRID_OPTIONS.modelConfig,
            ...options.modelConfig,
        },
    };

    const cacheKey = `${stationId}:${targetDate}:hybrid`;
    const cached = hybridForecastCache.get(cacheKey);
    if (cached && (Date.now() - cached.cachedAt.getTime()) < mergedOptions.cacheTtlMs) {
        return cached.forecast;
    }

    const station = getStation(stationId);
    if (!station) return null;

    const sources = await getForecastSources(stationId, targetDate);
    const forecasts = [sources.noaa, sources.openMeteo].filter(
        (forecast): forecast is WeatherForecast => Boolean(forecast)
    );
    const ensemble = buildEnsembleForecast(stationId, targetDate, forecasts);
    if (!ensemble) return null;

    if (!mergedOptions.mlEnabled) {
        return ensemble;
    }

    if (ensemble.forecastHigh === undefined || ensemble.forecastLow === undefined) {
        Logger.debug('Hybrid ML skipped - missing baseline forecast values');
        return ensemble;
    }

    const leadDays = ensemble.leadDays;
    const trainingData = await buildHybridTrainingData(
        stationId,
        mergedOptions.lookbackDays,
        leadDays,
        mergedOptions.allowSimulatedTraining,
        mergedOptions.trainingCacheTtlMs
    );

    if (trainingData.length < mergedOptions.minSamples) {
        Logger.debug(`Hybrid ML skipped - insufficient training data (${trainingData.length} samples)`);
        return ensemble;
    }

    const features = buildHybridFeatures({
        station,
        date: new Date(targetDate),
        leadDays,
        ensemble,
        noaa: sources.noaa || undefined,
        openMeteo: sources.openMeteo || undefined,
    });

    const sigmaFallback = ensemble.sigmaHigh ?? getForecastSigma(leadDays);
    const modelConfig: HybridModelConfig = {
        ...mergedOptions.modelConfig,
        min_samples: mergedOptions.minSamples,
        sigma_fallback: sigmaFallback,
    };

    const request = {
        station: {
            id: station.id,
            lat: station.lat,
            lon: station.lon,
        },
        target_date: targetDate,
        lead_days: leadDays,
        features,
        training_data: trainingData,
        config: modelConfig,
    };

    const response = await runHybridModel(request, mergedOptions.runtime);
    if (!response || response.error) {
        Logger.debug('Hybrid ML response unavailable, using ensemble forecast');
        return ensemble;
    }

    const hybrid = createHybridForecast(ensemble, response);
    const finalForecast = {
        ...hybrid,
        source: `HybridML(${ensemble.source})`,
    };

    hybridForecastCache.set(cacheKey, { forecast: finalForecast, cachedAt: new Date() });
    return finalForecast;
}

export default {
    getForecast,
    getEnsembleForecast,
    getHybridForecast,
    getCurrentObservation,
    getDailyMaxSoFar,
    getForecastSigma,
    getHistoricalDailyData,
    getHistoricalForecast,
    simulateForecast,
};
