/**
 * Weather Market Discovery Service
 * Discovers weather markets on Polymarket using the Weather tag API
 */

import axios from 'axios';
import Logger from '../utils/logger';
import { WeatherMarket, WeatherBin, WeatherMetric, WeatherUnit, WeatherMarketStatus } from '../interfaces/WeatherMarket';
import { upsertWeatherMarket, getActiveWeatherMarkets, markExpiredMarkets } from '../models/weatherMarket';
import { ENV } from '../config/env';
import { getStation, findStationByName, STATION_MAPPINGS } from '../config/weatherConfig';

const GAMMA_API_URL = 'https://gamma-api.polymarket.com';
const WEATHER_TAG_ID = '84'; // Weather tag on Polymarket

interface PolymarketMarket {
    id: string;
    question: string;
    slug: string;
    conditionId: string;
    outcomes: string;
    outcomePrices: string;
    tokens?: Array<{
        token_id: string;
        outcome: string;
        price?: string;
    }>;
    clobTokenIds?: string;
}

interface PolymarketEvent {
    id: string;
    title: string;
    slug: string;
    description: string;
    active: boolean;
    closed: boolean;
    endDate: string;
    markets: PolymarketMarket[];
}

/**
 * Fetch weather events from Polymarket using the Weather tag
 */
async function fetchWeatherEvents(): Promise<PolymarketEvent[]> {
    try {
        const url = `${GAMMA_API_URL}/events?tag_id=${WEATHER_TAG_ID}&closed=false&limit=200`;
        const response = await axios.get(url, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        });
        return response.data || [];
    } catch (error) {
        Logger.warning(`Failed to fetch weather events: ${error}`);
        return [];
    }
}

/**
 * Parse bin label from market question
 */
function parseBinFromQuestion(question: string): {
    lowerBound: number | null;
    upperBound: number | null;
    isFloor: boolean;
    isCeiling: boolean;
    label: string;
    unit: WeatherUnit;
} {
    // Fahrenheit patterns
    const belowMatchF = question.match(/(-?\d+)°?F\s*or\s*below/i);
    if (belowMatchF) {
        return { lowerBound: null, upperBound: parseInt(belowMatchF[1]), isFloor: true, isCeiling: false, label: `≤${belowMatchF[1]}°F`, unit: 'F' };
    }

    const aboveMatchF = question.match(/(-?\d+)°?F\s*or\s*higher/i);
    if (aboveMatchF) {
        return { lowerBound: parseInt(aboveMatchF[1]), upperBound: null, isFloor: false, isCeiling: true, label: `≥${aboveMatchF[1]}°F`, unit: 'F' };
    }

    const rangeMatchF = question.match(/between\s*(-?\d+)[-–](-?\d+)°?F/i);
    if (rangeMatchF) {
        const low = parseInt(rangeMatchF[1]);
        const high = parseInt(rangeMatchF[2]);
        return { lowerBound: low, upperBound: high, isFloor: false, isCeiling: false, label: `${low}-${high}°F`, unit: 'F' };
    }

    const singleMatchF = question.match(/\s+be\s+(-?\d+)°F\s+on/i);
    if (singleMatchF) {
        const val = parseInt(singleMatchF[1]);
        return { lowerBound: val, upperBound: val, isFloor: false, isCeiling: false, label: `${val}°F`, unit: 'F' };
    }

    // Celsius patterns
    const belowMatchC = question.match(/(-?\d+)°?C\s*or\s*below/i);
    if (belowMatchC) {
        return { lowerBound: null, upperBound: parseInt(belowMatchC[1]), isFloor: true, isCeiling: false, label: `≤${belowMatchC[1]}°C`, unit: 'C' };
    }

    const aboveMatchC = question.match(/(-?\d+)°?C\s*or\s*higher/i);
    if (aboveMatchC) {
        return { lowerBound: parseInt(aboveMatchC[1]), upperBound: null, isFloor: false, isCeiling: true, label: `≥${aboveMatchC[1]}°C`, unit: 'C' };
    }

    const rangeMatchC = question.match(/between\s*(-?\d+)[-–](-?\d+)°?C/i);
    if (rangeMatchC) {
        const low = parseInt(rangeMatchC[1]);
        const high = parseInt(rangeMatchC[2]);
        return { lowerBound: low, upperBound: high, isFloor: false, isCeiling: false, label: `${low}-${high}°C`, unit: 'C' };
    }

    const singleMatchC = question.match(/\s+be\s+(-?\d+)°C\s+on/i);
    if (singleMatchC) {
        const val = parseInt(singleMatchC[1]);
        return { lowerBound: val, upperBound: val, isFloor: false, isCeiling: false, label: `${val}°C`, unit: 'C' };
    }

    // Default
    return { lowerBound: null, upperBound: null, isFloor: false, isCeiling: false, label: question.substring(0, 30), unit: 'F' };
}

/**
 * Extract city from event title
 */
function extractCity(title: string): string {
    const match = title.match(/in\s+(.+?)\s+on/i);
    return match ? match[1] : 'Unknown';
}

/**
 * Extract date from event title
 */
function extractDate(title: string): string | null {
    const match = title.match(/on\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d+)/i);
    if (match) {
        const month = match[1];
        const day = match[2];
        const year = new Date().getFullYear();
        const monthNum = new Date(`${month} 1, 2000`).getMonth() + 1;
        return `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
}

/**
 * Map city name to station ID
 */
function cityToStationId(city: string): string | null {
    const cityLower = city.toLowerCase();

    // Direct mappings
    const cityMap: Record<string, string> = {
        'nyc': 'KLGA',
        'new york city': 'KLGA',
        'new york': 'KLGA',
        'chicago': 'KORD',
        'los angeles': 'KLAX',
        'la': 'KLAX',
        'dallas': 'KDFW',
        'denver': 'KDEN',
        'philadelphia': 'KPHL',
        'boston': 'KBOS',
        'austin': 'KAUS',
        'miami': 'KMIA',
        'san francisco': 'KSFO',
        'seattle': 'KSEA',
        'atlanta': 'KATL',
        'toronto': 'CYYZ',
        'london': 'EGLL',
        'seoul': 'RKSI',
        'buenos aires': 'SAEZ',
    };

    if (cityMap[cityLower]) {
        return cityMap[cityLower];
    }

    // Try finding in station mappings
    for (const [id, station] of STATION_MAPPINGS) {
        if (station.city.toLowerCase() === cityLower) {
            return id;
        }
    }

    return null;
}

/**
 * Parse price from market data
 */
function parsePrice(market: PolymarketMarket): number {
    try {
        if (market.outcomePrices) {
            const prices = JSON.parse(market.outcomePrices);
            if (prices && prices.length > 0) {
                return parseFloat(prices[0]);
            }
        }
    } catch {
        // Ignore
    }
    return 0;
}

/**
 * Get token ID from market
 */
function getTokenId(market: PolymarketMarket): string {
    try {
        if (market.clobTokenIds) {
            const tokens = JSON.parse(market.clobTokenIds);
            if (tokens && tokens.length > 0) {
                return tokens[0];
            }
        }
    } catch {
        // Ignore
    }
    return market.conditionId || market.id;
}

/**
 * Convert event to WeatherMarket format
 */
function eventToWeatherMarket(event: PolymarketEvent): WeatherMarket | null {
    const title = event.title || '';

    // Only process temperature events
    if (!title.toLowerCase().includes('temperature') || !title.toLowerCase().includes('highest')) {
        return null;
    }

    // Skip closed/inactive
    if (event.closed || !event.active) {
        return null;
    }

    const city = extractCity(title);
    const targetDate = extractDate(title);
    if (!targetDate) return null;

    const stationId = cityToStationId(city) || 'UNKNOWN';

    // Parse bins from markets
    const bins: WeatherBin[] = [];
    let unit: WeatherUnit = 'F';

    if (event.markets && event.markets.length > 0) {
        for (const market of event.markets) {
            const parsed = parseBinFromQuestion(market.question);
            const tokenId = getTokenId(market);

            bins.push({
                outcomeId: market.id,
                tokenId,
                label: parsed.label,
                lowerBound: parsed.lowerBound,
                upperBound: parsed.upperBound,
                isFloor: parsed.isFloor,
                isCeiling: parsed.isCeiling,
            });

            unit = parsed.unit;
        }
    }

    if (bins.length === 0) return null;

    // Sort bins
    bins.sort((a, b) => {
        if (a.isFloor) return -1;
        if (b.isFloor) return 1;
        if (a.isCeiling) return 1;
        if (b.isCeiling) return -1;
        return (a.lowerBound || 0) - (b.lowerBound || 0);
    });

    const station = getStation(stationId);

    return {
        conditionId: event.id,
        marketSlug: event.slug,
        title,
        stationId,
        stationName: station?.name || city,
        region: station?.region || city,
        targetDate,
        timezone: station?.timezone || 'America/New_York',
        metric: 'DAILY_MAX_TEMP' as WeatherMetric,
        unit,
        precision: 1,
        resolutionSourceUrl: station?.wundergroundUrl || '',
        bins,
        parsedAt: new Date(),
        confidence: stationId === 'UNKNOWN' ? 0.6 : 0.9,
        status: 'ACTIVE' as WeatherMarketStatus,
        resolvesAt: new Date(targetDate + 'T23:59:59'),
    };
}

/**
 * Discover and parse all active weather markets
 */
export async function discoverWeatherMarkets(): Promise<WeatherMarket[]> {
    Logger.info('Discovering weather markets on Polymarket (Weather tag)...');

    const events = await fetchWeatherEvents();
    Logger.info(`Found ${events.length} weather-related events`);

    const weatherMarkets: WeatherMarket[] = [];
    const minConfidence = ENV.WEATHER_MIN_PARSER_CONFIDENCE;

    for (const event of events) {
        const market = eventToWeatherMarket(event);

        if (market && market.confidence >= minConfidence) {
            weatherMarkets.push(market);

            // Store in database
            try {
                await upsertWeatherMarket(market);
            } catch (error) {
                Logger.debug(`Failed to upsert market: ${error}`);
            }

            Logger.info(`✓ Parsed: ${market.title.substring(0, 50)}... (${market.stationId}, ${market.targetDate})`);
        }
    }

    // Mark any expired markets
    try {
        const expired = await markExpiredMarkets();
        if (expired > 0) {
            Logger.info(`Marked ${expired} markets as expired`);
        }
    } catch (error) {
        Logger.debug(`Failed to mark expired: ${error}`);
    }

    Logger.success(`Discovered ${weatherMarkets.length} valid weather markets`);
    return weatherMarkets;
}

/**
 * Get all currently tracked active weather markets (from DB)
 */
export async function getTrackedWeatherMarkets(): Promise<WeatherMarket[]> {
    const markets = await getActiveWeatherMarkets();
    return markets.map(m => m.toObject() as WeatherMarket);
}

/**
 * Fetch current prices for market tokens
 */
async function fetchMarketPrices(tokenIds: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    try {
        const url = `${ENV.CLOB_HTTP_URL}/prices`;
        const response = await axios.post(url, { token_ids: tokenIds }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
        });

        if (response.data) {
            for (const [tokenId, priceData] of Object.entries(response.data)) {
                if (priceData && typeof priceData === 'object' && 'price' in priceData) {
                    prices.set(tokenId, parseFloat((priceData as any).price));
                }
            }
        }
    } catch (error) {
        Logger.warning(`Failed to fetch prices: ${error}`);
    }

    return prices;
}

/**
 * Refresh prices for all bins in tracked markets
 */
export async function refreshMarketPrices(markets: WeatherMarket[]): Promise<Map<string, Map<string, number>>> {
    const allTokenIds: string[] = [];

    for (const market of markets) {
        for (const bin of market.bins) {
            allTokenIds.push(bin.tokenId);
        }
    }

    const prices = await fetchMarketPrices(allTokenIds);

    // Organize by market conditionId -> tokenId -> price
    const marketPrices = new Map<string, Map<string, number>>();

    for (const market of markets) {
        const binPrices = new Map<string, number>();
        for (const bin of market.bins) {
            const price = prices.get(bin.tokenId);
            if (price !== undefined) {
                binPrices.set(bin.tokenId, price);
            }
        }
        marketPrices.set(market.conditionId, binPrices);
    }

    return marketPrices;
}

/**
 * Get markets resolving soon (within maxLeadDays)
 */
export async function getUpcomingMarkets(): Promise<WeatherMarket[]> {
    const allMarkets = await getTrackedWeatherMarkets();
    const maxLeadDays = ENV.WEATHER_MAX_LEAD_DAYS;
    const now = new Date();
    const cutoff = new Date(now.getTime() + maxLeadDays * 24 * 60 * 60 * 1000);

    return allMarkets.filter(m => {
        const resolves = new Date(m.resolvesAt);
        return resolves >= now && resolves <= cutoff;
    });
}

export default {
    discoverWeatherMarkets,
    getTrackedWeatherMarkets,
    refreshMarketPrices,
    getUpcomingMarkets,
};
