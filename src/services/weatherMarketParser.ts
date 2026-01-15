/**
 * Weather Market Parser
 * Parses Polymarket weather market rules into structured data
 */

import { WeatherMarket, WeatherBin, WeatherMetric, WeatherUnit, WeatherMarketStatus } from '../interfaces/WeatherMarket';
import { getStation, findStationByName, STATION_MAPPINGS } from '../config/weatherConfig';
import Logger from '../utils/logger';

/**
 * Common patterns in weather market questions/rules
 */
const PATTERNS = {
    // Match temperature ranges like "50-51", "52-53"
    tempRange: /(\d+)\s*[-–]\s*(\d+)/g,
    // Match "X or higher" or "X+"
    tempCeiling: /(\d+)\s*(?:or higher|\+|°?\s*F?\s*or (?:more|higher|above))/i,
    // Match "X or lower" or "below X"
    tempFloor: /(\d+)\s*(?:or lower|or less)|(?:below|under)\s*(\d+)/i,
    // Match station names in rules text (e.g., "LaGuardia Airport Station")
    stationName: /(?:at|from|by)\s+(?:the\s+)?([A-Za-z\s]+(?:Airport|Station)[A-Za-z\s]*)/i,
    // Match ICAO codes (e.g., KLGA)
    icaoCode: /\b(K[A-Z]{3})\b/g,
    // Match dates in various formats
    dateFormats: [
        /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*'?(\d{2,4})/i,
        /(\d{4})-(\d{2})-(\d{2})/,
        /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s*(\d{4})/i,
    ],
    // Match temperature keywords
    tempKeywords: /(?:highest|maximum|high|max|lowest|minimum|low|min)\s+temperature/i,
    // Match Weather Underground URL
    wundergroundUrl: /wunderground\.com\/history\/daily\/[^\s"]+/i,
    // Match Fahrenheit indicator
    fahrenheit: /fahrenheit|°\s*F|degrees?\s*F/i,
    // Match Celsius indicator
    celsius: /celsius|°\s*C|degrees?\s*C/i,
};

const MONTH_MAP: Record<string, number> = {
    'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
    'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
};

/**
 * Extract station ID from market rules
 */
export function extractStationId(rulesText: string): { stationId: string | null; stationName: string | null; confidence: number } {
    // Try to find ICAO code directly
    const icaoMatch = rulesText.match(PATTERNS.icaoCode);
    if (icaoMatch) {
        const station = getStation(icaoMatch[0]);
        if (station) {
            return { stationId: station.id, stationName: station.name, confidence: 1.0 };
        }
    }

    // Try to find station name
    const stationMatch = rulesText.match(PATTERNS.stationName);
    if (stationMatch) {
        const station = findStationByName(stationMatch[1]);
        if (station) {
            return { stationId: station.id, stationName: station.name, confidence: 0.9 };
        }
    }

    // Try matching against known station names
    for (const [id, station] of STATION_MAPPINGS) {
        if (rulesText.toLowerCase().includes(station.name.toLowerCase()) ||
            rulesText.toLowerCase().includes(station.city.toLowerCase() + ' airport')) {
            return { stationId: id, stationName: station.name, confidence: 0.85 };
        }
    }

    return { stationId: null, stationName: null, confidence: 0 };
}

/**
 * Extract target date from market rules or title
 */
export function extractTargetDate(text: string): { date: string | null; confidence: number } {
    for (const pattern of PATTERNS.dateFormats) {
        const match = text.match(pattern);
        if (match) {
            try {
                let year: number, month: number, day: number;

                if (pattern.source.startsWith('(\\d{4})')) {
                    // ISO format: 2026-01-14
                    year = parseInt(match[1]);
                    month = parseInt(match[2]) - 1;
                    day = parseInt(match[3]);
                } else if (pattern.source.startsWith('(\\d{1,2})')) {
                    // Format: 14 Jan '26 or 14 Jan 2026
                    day = parseInt(match[1]);
                    month = MONTH_MAP[match[2].toLowerCase().substring(0, 3)];
                    year = parseInt(match[3]);
                    if (year < 100) year += 2000;
                } else {
                    // Format: Jan 14, 2026
                    month = MONTH_MAP[match[1].toLowerCase().substring(0, 3)];
                    day = parseInt(match[2]);
                    year = parseInt(match[3]);
                }

                const date = new Date(year, month, day);
                return {
                    date: date.toISOString().split('T')[0],
                    confidence: 0.95
                };
            } catch {
                continue;
            }
        }
    }
    return { date: null, confidence: 0 };
}

/**
 * Extract metric type from market text
 */
export function extractMetric(text: string): { metric: WeatherMetric; confidence: number } {
    const lowerText = text.toLowerCase();

    if (lowerText.includes('highest') || lowerText.includes('maximum') || lowerText.includes('high temp')) {
        return { metric: 'DAILY_MAX_TEMP', confidence: 0.95 };
    }
    if (lowerText.includes('lowest') || lowerText.includes('minimum') || lowerText.includes('low temp')) {
        return { metric: 'DAILY_MIN_TEMP', confidence: 0.95 };
    }
    if (lowerText.includes('rain') || lowerText.includes('precipitation')) {
        return { metric: 'RAINFALL', confidence: 0.9 };
    }
    if (lowerText.includes('snow')) {
        return { metric: 'SNOWFALL', confidence: 0.9 };
    }

    // Default to max temp for generic "temperature" markets
    if (PATTERNS.tempKeywords.test(text)) {
        return { metric: 'DAILY_MAX_TEMP', confidence: 0.7 };
    }

    return { metric: 'DAILY_MAX_TEMP', confidence: 0.5 };
}

/**
 * Extract unit from market text
 */
export function extractUnit(text: string): { unit: WeatherUnit; confidence: number } {
    if (PATTERNS.fahrenheit.test(text)) {
        return { unit: 'F', confidence: 0.95 };
    }
    if (PATTERNS.celsius.test(text)) {
        return { unit: 'C', confidence: 0.95 };
    }
    // Default to Fahrenheit for US markets
    return { unit: 'F', confidence: 0.7 };
}

/**
 * Extract resolution source URL
 */
export function extractResolutionSourceUrl(text: string): string | null {
    const match = text.match(PATTERNS.wundergroundUrl);
    if (match) {
        return 'https://www.' + match[0];
    }
    return null;
}

/**
 * Parse bin labels from market outcomes
 * Expects outcomes like: ["49 or lower", "50-51", "52-53", "54 or higher"]
 */
export function parseBins(outcomes: Array<{ id: string; tokenId: string; label: string }>): WeatherBin[] {
    const bins: WeatherBin[] = [];

    for (const outcome of outcomes) {
        const label = outcome.label.trim();
        let lowerBound: number | null = null;
        let upperBound: number | null = null;
        let isFloor = false;
        let isCeiling = false;

        // Check for floor bin (e.g., "49 or lower")
        const floorMatch = label.match(/(\d+)\s*(?:or lower|or less|°?\s*F?\s*or (?:lower|less|below))/i) ||
                          label.match(/(?:below|under)\s*(\d+)/i);
        if (floorMatch) {
            upperBound = parseInt(floorMatch[1]);
            isFloor = true;
        }

        // Check for ceiling bin (e.g., "54 or higher")
        const ceilingMatch = label.match(/(\d+)\s*(?:or higher|\+|°?\s*F?\s*or (?:more|higher|above))/i);
        if (ceilingMatch) {
            lowerBound = parseInt(ceilingMatch[1]);
            isCeiling = true;
        }

        // Check for range bin (e.g., "50-51")
        if (!isFloor && !isCeiling) {
            const rangeMatch = label.match(/(\d+)\s*[-–]\s*(\d+)/);
            if (rangeMatch) {
                lowerBound = parseInt(rangeMatch[1]);
                upperBound = parseInt(rangeMatch[2]);
            } else {
                // Single value bin (e.g., just "50")
                const singleMatch = label.match(/^(\d+)$/);
                if (singleMatch) {
                    lowerBound = parseInt(singleMatch[1]);
                    upperBound = parseInt(singleMatch[1]);
                }
            }
        }

        bins.push({
            outcomeId: outcome.id,
            tokenId: outcome.tokenId,
            label,
            lowerBound,
            upperBound,
            isFloor,
            isCeiling,
        });
    }

    return bins;
}

/**
 * Parse a Polymarket event/market into a WeatherMarket structure
 */
export function parseWeatherMarket(
    marketData: {
        conditionId: string;
        slug: string;
        question: string;
        description?: string;
        rules?: string;
        outcomes?: Array<{ id: string; tokenId: string; label: string }>;
        endDate?: string;
    }
): { market: WeatherMarket | null; confidence: number; error?: string } {
    const fullText = [
        marketData.question || '',
        marketData.description || '',
        marketData.rules || ''
    ].join(' ');

    // Extract station
    const stationResult = extractStationId(fullText);
    if (!stationResult.stationId) {
        return { market: null, confidence: 0, error: 'Could not identify weather station' };
    }

    // Extract date
    const dateResult = extractTargetDate(fullText);
    if (!dateResult.date) {
        return { market: null, confidence: 0, error: 'Could not parse target date' };
    }

    // Extract metric
    const metricResult = extractMetric(fullText);

    // Extract unit
    const unitResult = extractUnit(fullText);

    // Extract resolution source
    const resolutionUrl = extractResolutionSourceUrl(fullText);

    // Parse bins from outcomes
    const bins = marketData.outcomes ? parseBins(marketData.outcomes) : [];
    if (bins.length === 0) {
        return { market: null, confidence: 0, error: 'No outcome bins found' };
    }

    // Get station details
    const station = getStation(stationResult.stationId)!;

    // Calculate resolves-at timestamp (end of target date in local timezone)
    const targetDate = new Date(dateResult.date + 'T23:59:59');

    // Calculate overall confidence
    const confidence = Math.min(
        stationResult.confidence,
        dateResult.confidence,
        metricResult.confidence,
        unitResult.confidence,
        bins.length > 0 ? 0.95 : 0
    );

    const market: WeatherMarket = {
        conditionId: marketData.conditionId,
        marketSlug: marketData.slug,
        title: marketData.question,
        stationId: stationResult.stationId,
        stationName: stationResult.stationName || station.name,
        region: station.region,
        targetDate: dateResult.date,
        timezone: station.timezone,
        metric: metricResult.metric,
        unit: unitResult.unit,
        precision: 1, // Whole degrees for temperature
        resolutionSourceUrl: resolutionUrl || station.wundergroundUrl,
        bins,
        parsedAt: new Date(),
        confidence,
        status: 'ACTIVE' as WeatherMarketStatus,
        resolvesAt: targetDate,
    };

    return { market, confidence };
}

/**
 * Check if a market question/title looks like a weather market
 */
export function isLikelyWeatherMarket(question: string): boolean {
    const lowerQuestion = question.toLowerCase();

    const weatherKeywords = [
        'temperature',
        'highest temp',
        'lowest temp',
        '°f',
        '°c',
        'fahrenheit',
        'celsius',
        'weather',
        'rainfall',
        'snowfall',
        'precipitation',
    ];

    const cityKeywords = [
        'nyc', 'new york', 'chicago', 'los angeles', 'dallas', 'denver',
        'philadelphia', 'boston', 'austin', 'miami', 'san francisco',
        'seattle', 'atlanta', 'la ',
    ];

    const hasWeatherKeyword = weatherKeywords.some(kw => lowerQuestion.includes(kw));
    const hasCityKeyword = cityKeywords.some(kw => lowerQuestion.includes(kw));

    return hasWeatherKeyword || (hasCityKeyword && /\d+/.test(question));
}

export default {
    parseWeatherMarket,
    isLikelyWeatherMarket,
    extractStationId,
    extractTargetDate,
    extractMetric,
    extractUnit,
    parseBins,
};
