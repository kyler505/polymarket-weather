import { spawn } from 'child_process';
import path from 'path';
import { StationMapping, WeatherForecast } from '../interfaces/WeatherMarket';
import Logger from './logger';

export const HYBRID_FEATURE_KEYS = [
    'baseline_high',
    'baseline_low',
    'spread_high',
    'spread_low',
    'lead_days',
    'day_of_year_sin',
    'day_of_year_cos',
    'lat',
    'lon',
];

export interface HybridFeaturePayload {
    baseline_high: number;
    baseline_low: number;
    spread_high: number;
    spread_low: number;
    lead_days: number;
    day_of_year_sin: number;
    day_of_year_cos: number;
    lat: number;
    lon: number;
}

export interface HybridTrainingSample {
    date: string;
    features: HybridFeaturePayload;
    target_high: number;
    target_low: number;
}

export interface HybridModelConfig {
    ridge_alpha: number;
    knn_k: number;
    min_samples: number;
    calibration_split: number;
    clip_delta: number;
    sigma_floor: number;
    sigma_fallback?: number;
    seed?: number;
}

export interface HybridModelRequest {
    station: {
        id: string;
        lat: number;
        lon: number;
    };
    target_date: string;
    lead_days: number;
    features: HybridFeaturePayload;
    training_data: HybridTrainingSample[];
    config: HybridModelConfig;
    feature_keys?: string[];
}

export interface HybridModelResponse {
    forecast_high?: number;
    forecast_low?: number;
    sigma_high?: number;
    sigma_low?: number;
    model_info?: Record<string, unknown>;
    error?: string;
}

export interface HybridModelRuntimeConfig {
    pythonPath: string;
    scriptPath?: string;
    timeoutMs: number;
}

const toNumber = (value: number | undefined | null, fallback: number): number => {
    return Number.isFinite(value) ? (value as number) : fallback;
};

const getDayOfYear = (date: Date): number => {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date.getTime() - start.getTime();
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);
};

export const buildHybridFeatures = ({
    station,
    date,
    leadDays,
    ensemble,
    noaa,
    openMeteo,
}: {
    station: StationMapping;
    date: Date;
    leadDays: number;
    ensemble: WeatherForecast;
    noaa?: WeatherForecast | null;
    openMeteo?: WeatherForecast | null;
}): HybridFeaturePayload => {
    const dayOfYear = getDayOfYear(date);
    const radians = (2 * Math.PI * dayOfYear) / 365;

    const baselineHigh = toNumber(ensemble.forecastHigh, 0);
    const baselineLow = toNumber(ensemble.forecastLow, 0);

    const noaaHigh = noaa?.forecastHigh;
    const openHigh = openMeteo?.forecastHigh;
    const noaaLow = noaa?.forecastLow;
    const openLow = openMeteo?.forecastLow;

    const spreadHigh = Number.isFinite(noaaHigh) && Number.isFinite(openHigh)
        ? Math.abs((noaaHigh as number) - (openHigh as number))
        : 0;
    const spreadLow = Number.isFinite(noaaLow) && Number.isFinite(openLow)
        ? Math.abs((noaaLow as number) - (openLow as number))
        : 0;

    return {
        baseline_high: baselineHigh,
        baseline_low: baselineLow,
        spread_high: spreadHigh,
        spread_low: spreadLow,
        lead_days: leadDays,
        day_of_year_sin: Math.sin(radians),
        day_of_year_cos: Math.cos(radians),
        lat: station.lat,
        lon: station.lon,
    };
};

export const runHybridModel = async (
    request: HybridModelRequest,
    runtime: HybridModelRuntimeConfig
): Promise<HybridModelResponse | null> => {
    const pythonPath = runtime.pythonPath || 'python3';
    const scriptPath =
        runtime.scriptPath || path.join(process.cwd(), 'ml', 'hybrid_weather_model.py');

    const payload = JSON.stringify({
        ...request,
        feature_keys: request.feature_keys || HYBRID_FEATURE_KEYS,
    });

    return new Promise((resolve) => {
        const child = spawn(pythonPath, [scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        const timeout = setTimeout(() => {
            child.kill('SIGTERM');
            Logger.warning('Hybrid ML model timed out');
            resolve(null);
        }, runtime.timeoutMs);

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                Logger.warning(`Hybrid ML model exited with code ${code}: ${stderr}`);
                resolve(null);
                return;
            }
            try {
                const parsed = JSON.parse(stdout) as HybridModelResponse;
                resolve(parsed);
            } catch (error) {
                Logger.warning(`Hybrid ML model output parse failed: ${error}`);
                resolve(null);
            }
        });

        child.on('error', (error) => {
            clearTimeout(timeout);
            Logger.warning(`Hybrid ML model process error: ${error}`);
            resolve(null);
        });

        child.stdin.write(payload);
        child.stdin.end();
    });
};

export const createHybridForecast = (
    baseForecast: WeatherForecast,
    mlResponse: HybridModelResponse | null
): WeatherForecast => {
    if (!mlResponse) {
        return baseForecast;
    }

    return {
        ...baseForecast,
        forecastHigh: mlResponse.forecast_high ?? baseForecast.forecastHigh,
        forecastLow: mlResponse.forecast_low ?? baseForecast.forecastLow,
        sigmaHigh: mlResponse.sigma_high ?? baseForecast.sigmaHigh,
        sigmaLow: mlResponse.sigma_low ?? baseForecast.sigmaLow,
        model: 'hybrid-ml-v1',
        modelInfo: mlResponse.model_info,
    };
};
