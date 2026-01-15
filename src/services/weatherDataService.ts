/**
 * Weather Data Service
 * Fetches weather forecasts and observations from multiple sources
 */

import axios from 'axios';
import { WeatherForecast, WeatherObservation } from '../interfaces/WeatherMarket';
import { getStation, getSigmaForLeadDays, WEATHER_API } from '../config/weatherConfig';
import Logger from '../utils/logger';

// Cache for forecasts to reduce API calls
const forecastCache = new Map<string, { forecast: WeatherForecast; cachedAt: Date }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const dailyCache = new Map<string, { maxTemp: number; minTemp: number }>();

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
        const now = new Date();
        const leadDays = Math.ceil((targetDateObj.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

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

        const targetDateObj = new Date(targetDate);
        const now = new Date();
        const leadDays = Math.ceil((targetDateObj.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

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
        forecastCache.set(cacheKey, { forecast, cachedAt: new Date() });
    }

    return forecast;
}

/**
 * Get ensemble forecast (combines multiple sources with weighted average)
 */
export async function getEnsembleForecast(stationId: string, targetDate: string): Promise<WeatherForecast | null> {
    const station = getStation(stationId);
    if (!station) return null;

    const forecasts: WeatherForecast[] = [];

    // Get NOAA forecast
    const noaa = await fetchNOAAForecast(station.lat, station.lon, targetDate);
    if (noaa) {
        noaa.stationId = stationId;
        forecasts.push(noaa);
    }

    // Get Open-Meteo forecast
    const openMeteo = await fetchOpenMeteoForecast(station.lat, station.lon, targetDate);
    if (openMeteo) {
        openMeteo.stationId = stationId;
        forecasts.push(openMeteo);
    }

    if (forecasts.length === 0) return null;

    // Average the forecasts
    let sumHigh = 0, countHigh = 0;
    let sumLow = 0, countLow = 0;
    let leadDays = 0;

    for (const f of forecasts) {
        if (f.forecastHigh !== undefined) {
            sumHigh += f.forecastHigh;
            countHigh++;
        }
        if (f.forecastLow !== undefined) {
            sumLow += f.forecastLow;
            countLow++;
        }
        leadDays = f.leadDays;
    }

    return {
        stationId,
        targetDate,
        forecastHigh: countHigh > 0 ? sumHigh / countHigh : undefined,
        forecastLow: countLow > 0 ? sumLow / countLow : undefined,
        source: `Ensemble(${forecasts.map(f => f.source).join('+')})`,
        retrievedAt: new Date(),
        leadDays,
    };
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
    };
}

export default {
    getForecast,
    getEnsembleForecast,
    getCurrentObservation,
    getDailyMaxSoFar,
    getForecastSigma,
    getHistoricalDailyData,
    simulateForecast,
};
