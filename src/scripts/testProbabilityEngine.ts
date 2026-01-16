/**
 * Test Probability Engine Script
 * Tests the probability engine against live weather markets
 *
 * Usage: npm run test-probability
 */

import chalk from 'chalk';
import axios from 'axios';
import { computeBinProbabilities, analyzeBinProbabilities, kellyFraction } from '../services/probabilityEngine';
import { getForecast, getEnsembleForecast, getForecastSigma } from '../services/weatherDataService';
import { WeatherMarket, WeatherBin, WeatherForecast, WeatherMetric, WeatherUnit, WeatherMarketStatus } from '../interfaces/WeatherMarket';
import { getStation, STATION_MAPPINGS } from '../config/weatherConfig';

const GAMMA_API_URL = 'https://gamma-api.polymarket.com';
const WEATHER_TAG_ID = '84';

interface PolymarketMarket {
    id: string;
    question: string;
    slug: string;
    conditionId: string;
    outcomes: string;
    outcomePrices: string;
    clobTokenIds?: string;
}

interface PolymarketEvent {
    id: string;
    title: string;
    slug: string;
    active: boolean;
    closed: boolean;
    endDate: string;
    markets: PolymarketMarket[];
}

/**
 * Fetch a few weather events for testing
 */
async function fetchTestEvents(): Promise<PolymarketEvent[]> {
    try {
        const url = `${GAMMA_API_URL}/events?tag_id=${WEATHER_TAG_ID}&closed=false&limit=50`;
        const response = await axios.get(url, { timeout: 30000 });
        return response.data || [];
    } catch (error) {
        console.error(chalk.red('✗'), 'Failed to fetch events:', error);
        return [];
    }
}

/**
 * Parse bin from question
 */
function parseBinFromQuestion(question: string): {
    lowerBound: number | null;
    upperBound: number | null;
    isFloor: boolean;
    isCeiling: boolean;
    label: string;
    unit: 'F' | 'C';
} {
    // Fahrenheit
    const belowF = question.match(/(-?\d+)°?F\s*or\s*below/i);
    if (belowF) return { lowerBound: null, upperBound: parseInt(belowF[1]), isFloor: true, isCeiling: false, label: `≤${belowF[1]}°F`, unit: 'F' };

    const aboveF = question.match(/(-?\d+)°?F\s*or\s*higher/i);
    if (aboveF) return { lowerBound: parseInt(aboveF[1]), upperBound: null, isFloor: false, isCeiling: true, label: `≥${aboveF[1]}°F`, unit: 'F' };

    const rangeF = question.match(/between\s*(-?\d+)[-–](-?\d+)°?F/i);
    if (rangeF) return { lowerBound: parseInt(rangeF[1]), upperBound: parseInt(rangeF[2]), isFloor: false, isCeiling: false, label: `${rangeF[1]}-${rangeF[2]}°F`, unit: 'F' };

    const singleF = question.match(/\s+be\s+(-?\d+)°F\s+on/i);
    if (singleF) return { lowerBound: parseInt(singleF[1]), upperBound: parseInt(singleF[1]), isFloor: false, isCeiling: false, label: `${singleF[1]}°F`, unit: 'F' };

    // Celsius
    const belowC = question.match(/(-?\d+)°?C\s*or\s*below/i);
    if (belowC) return { lowerBound: null, upperBound: parseInt(belowC[1]), isFloor: true, isCeiling: false, label: `≤${belowC[1]}°C`, unit: 'C' };

    const aboveC = question.match(/(-?\d+)°?C\s*or\s*higher/i);
    if (aboveC) return { lowerBound: parseInt(aboveC[1]), upperBound: null, isFloor: false, isCeiling: true, label: `≥${aboveC[1]}°C`, unit: 'C' };

    const rangeC = question.match(/between\s*(-?\d+)[-–](-?\d+)°?C/i);
    if (rangeC) return { lowerBound: parseInt(rangeC[1]), upperBound: parseInt(rangeC[2]), isFloor: false, isCeiling: false, label: `${rangeC[1]}-${rangeC[2]}°C`, unit: 'C' };

    const singleC = question.match(/\s+be\s+(-?\d+)°C\s+on/i);
    if (singleC) return { lowerBound: parseInt(singleC[1]), upperBound: parseInt(singleC[1]), isFloor: false, isCeiling: false, label: `${singleC[1]}°C`, unit: 'C' };

    return { lowerBound: null, upperBound: null, isFloor: false, isCeiling: false, label: '?', unit: 'F' };
}

/**
 * Extract city and date from title
 */
function parseTitle(title: string): { city: string; date: string | null } {
    const cityMatch = title.match(/in\s+(.+?)\s+on/i);
    const dateMatch = title.match(/on\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d+)/i);

    const city = cityMatch ? cityMatch[1] : 'Unknown';
    let date: string | null = null;

    if (dateMatch) {
        const month = dateMatch[1];
        const day = dateMatch[2];
        const year = new Date().getFullYear();
        const monthNum = new Date(`${month} 1, 2000`).getMonth() + 1;
        date = `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    return { city, date };
}

/**
 * Map city to station
 */
function cityToStation(city: string): { id: string; lat: number; lon: number } | null {
    const cityLower = city.toLowerCase();
    const cityMap: Record<string, string> = {
        'nyc': 'KLGA', 'new york city': 'KLGA', 'new york': 'KLGA',
        'chicago': 'KORD', 'los angeles': 'KLAX', 'dallas': 'KDFW',
        'denver': 'KDEN', 'seattle': 'KSEA', 'atlanta': 'KATL',
        'boston': 'KBOS', 'miami': 'KMIA', 'san francisco': 'KSFO',
    };

    const stationId = cityMap[cityLower];
    if (stationId) {
        const station = getStation(stationId);
        if (station) {
            return { id: stationId, lat: station.lat, lon: station.lon };
        }
    }

    // Fallback coords for international cities
    const intlCoords: Record<string, { id: string; lat: number; lon: number }> = {
        'toronto': { id: 'CYYZ', lat: 43.6777, lon: -79.6248 },
        'london': { id: 'EGLL', lat: 51.4700, lon: -0.4543 },
        'seoul': { id: 'RKSI', lat: 37.4602, lon: 126.4407 },
        'buenos aires': { id: 'SAEZ', lat: -34.8222, lon: -58.5358 },
    };

    return intlCoords[cityLower] || null;
}

/**
 * Convert event to test market
 */
function eventToTestMarket(event: PolymarketEvent): { market: WeatherMarket; prices: Map<string, number> } | null {
    const title = event.title || '';
    if (!title.toLowerCase().includes('temperature')) return null;
    if (event.closed || !event.active) return null;

    const { city, date } = parseTitle(title);
    if (!date) return null;

    const stationInfo = cityToStation(city);
    if (!stationInfo) return null;

    const bins: WeatherBin[] = [];
    const prices = new Map<string, number>();
    let unit: WeatherUnit = 'F';

    for (const mkt of event.markets || []) {
        const parsed = parseBinFromQuestion(mkt.question);
        const tokenId = mkt.id;

        bins.push({
            outcomeId: mkt.id,
            tokenId,
            label: parsed.label,
            lowerBound: parsed.lowerBound,
            upperBound: parsed.upperBound,
            isFloor: parsed.isFloor,
            isCeiling: parsed.isCeiling,
        });

        // Get price
        try {
            const priceArr = JSON.parse(mkt.outcomePrices);
            if (priceArr && priceArr.length > 0) {
                prices.set(tokenId, parseFloat(priceArr[0]));
            }
        } catch {}

        unit = parsed.unit;
    }

    if (bins.length === 0) return null;

    bins.sort((a, b) => {
        if (a.isFloor) return -1;
        if (b.isFloor) return 1;
        if (a.isCeiling) return 1;
        if (b.isCeiling) return -1;
        return (a.lowerBound || 0) - (b.lowerBound || 0);
    });

    const market: WeatherMarket = {
        conditionId: event.id,
        marketSlug: event.slug,
        title,
        stationId: stationInfo.id,
        stationName: city,
        region: city,
        targetDate: date,
        timezone: 'America/New_York',
        metric: 'DAILY_MAX_TEMP',
        unit,
        precision: 1,
        resolutionSourceUrl: '',
        bins,
        parsedAt: new Date(),
        confidence: 0.9,
        status: 'ACTIVE',
        resolvesAt: new Date(date + 'T23:59:59'),
    };

    return { market, prices };
}

/**
 * Fetch forecast for a city
 */
async function fetchForecastForCity(lat: number, lon: number, targetDate: string, stationId: string): Promise<WeatherForecast | null> {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&start_date=${targetDate}&end_date=${targetDate}`;
        const response = await axios.get(url, { timeout: 10000 });

        const daily = response.data.daily;
        if (!daily || !daily.time) return null;

        const idx = daily.time.indexOf(targetDate);
        if (idx === -1) return null;

        const now = new Date();
        const target = new Date(targetDate);
        const leadDays = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        return {
            stationId,
            targetDate,
            forecastHigh: daily.temperature_2m_max?.[idx],
            forecastLow: daily.temperature_2m_min?.[idx],
            source: 'Open-Meteo',
            retrievedAt: new Date(),
            leadDays: Math.max(0, leadDays),
        };
    } catch (error) {
        return null;
    }
}

/**
 * Main test function
 */
async function testProbabilityEngine(): Promise<void> {
    console.log('');
    console.log(chalk.cyan('━'.repeat(70)));
    console.log(chalk.cyan.bold('  🧮 PROBABILITY ENGINE TEST'));
    console.log(chalk.cyan('━'.repeat(70)));
    console.log('');

    console.log(chalk.blue('ℹ'), 'Fetching weather events from Polymarket...');
    const events = await fetchTestEvents();

    // Filter to temperature events
    const tempEvents = events.filter(e =>
        e.title?.toLowerCase().includes('temperature') &&
        e.title?.toLowerCase().includes('highest')
    );

    console.log(chalk.blue('ℹ'), `Found ${tempEvents.length} temperature events`);

    // Pick a few US-based events for testing (better forecast availability)
    const testCities = ['NYC', 'Dallas', 'Seattle', 'Atlanta'];
    const testEvents: PolymarketEvent[] = [];

    for (const city of testCities) {
        const found = tempEvents.find(e => e.title.toLowerCase().includes(city.toLowerCase()));
        if (found) testEvents.push(found);
    }

    if (testEvents.length === 0) {
        console.log(chalk.yellow('⚠'), 'No suitable test markets found');
        return;
    }

    console.log(chalk.green('✓'), `Testing with ${testEvents.length} markets`);

    for (const event of testEvents) {
        const result = eventToTestMarket(event);
        if (!result) continue;

        const { market, prices } = result;
        const stationInfo = cityToStation(market.stationName);
        if (!stationInfo) continue;

        console.log('');
        console.log(chalk.magenta('─'.repeat(70)));
        console.log(chalk.magenta.bold(`📊 ${market.title}`));
        console.log(chalk.gray(`   Station: ${market.stationId} | Date: ${market.targetDate}`));

        // Fetch forecast
        const forecast = await fetchForecastForCity(
            stationInfo.lat,
            stationInfo.lon,
            market.targetDate,
            stationInfo.id
        );

        if (!forecast) {
            console.log(chalk.yellow('   ⚠ Could not fetch forecast'));
            continue;
        }

        const sigma = forecast.sigmaHigh ?? getForecastSigma(forecast.leadDays);
        console.log(chalk.gray(`   Forecast: ${forecast.forecastHigh?.toFixed(1)}°F high | Lead: ${forecast.leadDays} days | σ: ${sigma.toFixed(1)}°F`));

        // Compute probabilities
        const fairProbs = computeBinProbabilities(forecast, market.bins, market.metric);

        console.log('');
        console.log(chalk.gray('   Bin               Fair Prob   Market    Edge      Kelly'));
        console.log(chalk.gray('   ─────────────────────────────────────────────────────────'));

        let bestEdge = 0;
        let bestBin = '';

        for (const bin of market.bins) {
            const fairProb = fairProbs.get(bin.tokenId) || 0;
            const marketPrice = prices.get(bin.tokenId) || 0;
            const edge = fairProb - marketPrice;
            const kelly = kellyFraction(fairProb, marketPrice, 0.05);

            if (edge > bestEdge) {
                bestEdge = edge;
                bestBin = bin.label;
            }

            const edgeColor = edge > 0.05 ? chalk.green : edge < -0.05 ? chalk.red : chalk.white;
            const edgeStr = edgeColor(`${edge >= 0 ? '+' : ''}${(edge * 100).toFixed(1)}%`);
            const kellyStr = kelly > 0 ? chalk.yellow(`${(kelly * 100).toFixed(1)}%`) : chalk.gray('--');

            console.log(
                chalk.gray('   ') +
                chalk.white(bin.label.padEnd(14)) + '  ' +
                chalk.cyan(`${(fairProb * 100).toFixed(1)}%`.padStart(7)) + '  ' +
                chalk.yellow(`${(marketPrice * 100).toFixed(1)}%`.padStart(7)) + '  ' +
                edgeStr.padStart(12) + '  ' +
                kellyStr.padStart(8)
            );
        }

        if (bestEdge > 0.05) {
            console.log('');
            console.log(chalk.green(`   🎯 Best opportunity: ${bestBin} (+${(bestEdge * 100).toFixed(1)}% edge)`));
        }
    }

    console.log('');
    console.log(chalk.cyan('━'.repeat(70)));
    console.log(chalk.green('✓'), 'Probability engine test complete');
    console.log(chalk.cyan('━'.repeat(70)));
    console.log('');
}

// Run the test
testProbabilityEngine().catch(error => {
    console.error(chalk.red('✗'), 'Error:', error.message);
    process.exit(1);
});
