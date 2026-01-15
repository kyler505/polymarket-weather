/**
 * Weather Market Interfaces
 * Types for weather prediction market parsing, tracking, and trading
 */

/**
 * Temperature metric types
 */
export type WeatherMetric = 'DAILY_MAX_TEMP' | 'DAILY_MIN_TEMP' | 'RAINFALL' | 'SNOWFALL';

/**
 * Temperature/measurement units
 */
export type WeatherUnit = 'F' | 'C' | 'inches' | 'cm';

/**
 * Market status
 */
export type WeatherMarketStatus = 'ACTIVE' | 'RESOLVED' | 'SKIPPED' | 'EXPIRED';

/**
 * A single outcome bin in a weather ladder market
 * e.g., "50-51°F" or "52 or higher"
 */
export interface WeatherBin {
    /** Polymarket outcome/token ID */
    outcomeId: string;
    /** Token ID for trading */
    tokenId: string;
    /** Display label, e.g., "50-51" or "52 or higher" */
    label: string;
    /** Lower bound (inclusive), null for "X or lower" bins */
    lowerBound: number | null;
    /** Upper bound (inclusive), null for "X or higher" bins */
    upperBound: number | null;
    /** True if this is the floor bin (e.g., "49 or lower") */
    isFloor: boolean;
    /** True if this is the ceiling bin (e.g., "52 or higher") */
    isCeiling: boolean;
}

/**
 * Parsed weather market structure
 */
export interface WeatherMarket {
    /** Polymarket condition ID */
    conditionId: string;
    /** Market slug for URL */
    marketSlug: string;
    /** Market title/question */
    title: string;
    /** Weather station ID (e.g., "KLGA") */
    stationId: string;
    /** Human-readable station name (e.g., "LaGuardia Airport") */
    stationName: string;
    /** City/region for grouping */
    region: string;
    /** Target date in ISO format (e.g., "2026-01-14") */
    targetDate: string;
    /** Timezone for the market (e.g., "America/New_York") */
    timezone: string;
    /** What's being measured */
    metric: WeatherMetric;
    /** Unit of measurement */
    unit: WeatherUnit;
    /** Precision (e.g., 1 for whole degrees) */
    precision: number;
    /** Resolution source URL */
    resolutionSourceUrl: string;
    /** Parsed bins/outcomes */
    bins: WeatherBin[];
    /** When the market was parsed */
    parsedAt: Date;
    /** Parser confidence score (0-1) */
    confidence: number;
    /** Current market status */
    status: WeatherMarketStatus;
    /** When market resolves (end of target date in local timezone) */
    resolvesAt: Date;
}

/**
 * Weather forecast data
 */
export interface WeatherForecast {
    /** Station ID */
    stationId: string;
    /** Forecast target date */
    targetDate: string;
    /** Forecasted high temperature */
    forecastHigh?: number;
    /** Forecasted low temperature */
    forecastLow?: number;
    /** Forecast source (e.g., "NOAA", "Open-Meteo") */
    source: string;
    /** When the forecast was retrieved */
    retrievedAt: Date;
    /** Days until the target date (lead time) */
    leadDays: number;
}

/**
 * Current weather observation
 */
export interface WeatherObservation {
    /** Station ID */
    stationId: string;
    /** Observation timestamp */
    timestamp: Date;
    /** Current temperature */
    temperature?: number;
    /** Maximum temperature recorded so far today */
    maxSoFar?: number;
    /** Minimum temperature recorded so far today */
    minSoFar?: number;
    /** Data source */
    source: string;
}

/**
 * Bin probability calculation result
 */
export interface BinProbability {
    /** Bin outcome ID */
    outcomeId: string;
    /** Bin label */
    label: string;
    /** Calculated fair probability (0-1) */
    fairProbability: number;
    /** Current market price (0-1) */
    marketPrice: number;
    /** Edge = fairProbability - marketPrice */
    edge: number;
    /** Whether this bin is still possible given observations */
    isPossible: boolean;
}

/**
 * Trading signal for a weather market
 */
export interface WeatherTradeSignal {
    /** The market */
    market: WeatherMarket;
    /** Bin to trade */
    bin: WeatherBin;
    /** Trade side: BUY or SELL */
    side: 'BUY' | 'SELL';
    /** Our calculated fair probability */
    fairProbability: number;
    /** Current market price */
    marketPrice: number;
    /** Edge (positive = favorable) */
    edge: number;
    /** Recommended position size in USD */
    recommendedSizeUSD: number;
    /** Reason for the signal */
    reason: string;
    /** Forecast data used */
    forecast: WeatherForecast;
    /** Max-so-far observation if day-of */
    maxSoFar?: number;
    /** Generated at timestamp */
    generatedAt: Date;
}

/**
 * Station mapping for known weather stations
 */
export interface StationMapping {
    /** Station ID (ICAO code) */
    id: string;
    /** Human-readable name */
    name: string;
    /** City */
    city: string;
    /** Region/State */
    region: string;
    /** Timezone */
    timezone: string;
    /** Weather Underground URL template */
    wundergroundUrl: string;
    /** NOAA station ID (if different) */
    noaaStationId?: string;
    /** Latitude */
    lat: number;
    /** Longitude */
    lon: number;
}
