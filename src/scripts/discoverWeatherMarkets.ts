/**
 * Weather Market Discovery Script
 * Discovers and displays weather prediction markets on Polymarket
 *
 * Usage: npm run discover
 */

import chalk from 'chalk';
import axios from 'axios';
import { WeatherBin } from '../interfaces/WeatherMarket';

const GAMMA_API_URL = 'https://gamma-api.polymarket.com';
const WEATHER_TAG_ID = '84'; // Weather tag ID on Polymarket

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

interface TemperatureEvent {
    title: string;
    slug: string;
    city: string;
    date: string;
    endDate: string;
    bins: Array<{
        question: string;
        price: number;
        label: string;
    }>;
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
        console.error(chalk.red('✗'), 'Failed to fetch weather events:', error);
        return [];
    }
}

/**
 * Parse temperature bins from market questions
 */
function parseBinLabel(question: string): string {
    // Extract temperature range from question
    // E.g., "Will the highest temperature... be 25°F or below" -> "≤25°F"
    // E.g., "Will the highest temperature... be between 26-27°F" -> "26-27°F"
    // E.g., "Will the highest temperature... be 36°F or higher" -> "≥36°F"
    // E.g., "Will the highest temperature... be 2°C on" -> "2°C"

    // Fahrenheit patterns
    const belowMatchF = question.match(/(-?\d+)°?F\s*or\s*below/i);
    if (belowMatchF) return `≤${belowMatchF[1]}°F`;

    const aboveMatchF = question.match(/(-?\d+)°?F\s*or\s*higher/i);
    if (aboveMatchF) return `≥${aboveMatchF[1]}°F`;

    const rangeMatchF = question.match(/between\s*(-?\d+)[-–](-?\d+)°?F/i);
    if (rangeMatchF) return `${rangeMatchF[1]}-${rangeMatchF[2]}°F`;

    // Single degree Fahrenheit (e.g., "be 34°F on")
    const singleMatchF = question.match(/\s+be\s+(-?\d+)°F\s+on/i);
    if (singleMatchF) return `${singleMatchF[1]}°F`;

    // Celsius patterns
    const belowMatchC = question.match(/(-?\d+)°?C\s*or\s*below/i);
    if (belowMatchC) return `≤${belowMatchC[1]}°C`;

    const aboveMatchC = question.match(/(-?\d+)°?C\s*or\s*higher/i);
    if (aboveMatchC) return `≥${aboveMatchC[1]}°C`;

    const rangeMatchC = question.match(/between\s*(-?\d+)[-–](-?\d+)°?C/i);
    if (rangeMatchC) return `${rangeMatchC[1]}-${rangeMatchC[2]}°C`;

    // Single degree Celsius (e.g., "be 2°C on")
    const singleMatchC = question.match(/\s+be\s+(-?\d+)°C\s+on/i);
    if (singleMatchC) return `${singleMatchC[1]}°C`;

    // Generic number patterns (for edge cases)
    const genericBelow = question.match(/(\d+)\s*or\s*below/i);
    if (genericBelow) return `≤${genericBelow[1]}`;

    const genericAbove = question.match(/(\d+)\s*or\s*higher/i);
    if (genericAbove) return `≥${genericAbove[1]}`;

    const genericRange = question.match(/between\s*(-?\d+)[-–](-?\d+)/i);
    if (genericRange) return `${genericRange[1]}-${genericRange[2]}`;

    return question.substring(0, 30);
}

/**
 * Extract city name from event title
 */
function extractCity(title: string): string {
    const match = title.match(/in\s+(.+?)\s+on/i);
    return match ? match[1] : 'Unknown';
}

/**
 * Extract date from event title
 */
function extractDate(title: string, endDate: string): string {
    // Try to extract from title (e.g., "January 16")
    const match = title.match(/on\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d+)/i);
    if (match) {
        const month = match[1];
        const day = match[2];
        // Assume current year
        const year = new Date().getFullYear();
        const monthNum = new Date(`${month} 1, 2000`).getMonth() + 1;
        return `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    // Fall back to endDate
    return endDate ? endDate.split('T')[0] : 'Unknown';
}

/**
 * Parse prices from market data
 */
function parsePrice(market: PolymarketMarket): number {
    try {
        // Try outcomePrices first (for "Yes" outcome)
        if (market.outcomePrices) {
            const prices = JSON.parse(market.outcomePrices);
            if (prices && prices.length > 0) {
                return parseFloat(prices[0]);
            }
        }
    } catch {
        // Ignore parse errors
    }
    return 0;
}

/**
 * Process events into temperature market format
 */
function processTemperatureEvents(events: PolymarketEvent[]): TemperatureEvent[] {
    const temperatureEvents: TemperatureEvent[] = [];

    for (const event of events) {
        // Filter for temperature events
        const title = event.title || '';
        if (!title.toLowerCase().includes('temperature') || !title.toLowerCase().includes('highest')) {
            continue;
        }

        // Skip closed/inactive events
        if (event.closed || !event.active) {
            continue;
        }

        const city = extractCity(title);
        const date = extractDate(title, event.endDate);

        // Process markets (bins)
        const bins: Array<{ question: string; price: number; label: string }> = [];

        if (event.markets && event.markets.length > 0) {
            for (const market of event.markets) {
                const price = parsePrice(market);
                bins.push({
                    question: market.question,
                    price,
                    label: parseBinLabel(market.question),
                });
            }
        }

        // Sort bins by temperature
        bins.sort((a, b) => {
            const getTemp = (label: string): number => {
                const match = label.match(/(\d+)/);
                return match ? parseInt(match[1]) : 0;
            };
            return getTemp(a.label) - getTemp(b.label);
        });

        temperatureEvents.push({
            title,
            slug: event.slug,
            city,
            date,
            endDate: event.endDate,
            bins,
        });
    }

    // Sort by date
    temperatureEvents.sort((a, b) => a.date.localeCompare(b.date));

    return temperatureEvents;
}

/**
 * Calculate lead days (days until target date)
 */
function getLeadDays(dateStr: string): number {
    const target = new Date(dateStr);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diffTime = target.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Display a single temperature event
 */
function displayEvent(event: TemperatureEvent, index: number): void {
    const leadDays = getLeadDays(event.date);
    const leadDaysStr = leadDays === 0 ? chalk.red('TODAY') :
                        leadDays === 1 ? chalk.yellow('Tomorrow') :
                        leadDays < 0 ? chalk.gray('Past') :
                        chalk.green(`${leadDays} days`);

    console.log('');
    console.log(chalk.cyan('─'.repeat(65)));
    console.log(chalk.cyan.bold(`📊 MARKET ${index}: `) + chalk.white.bold(event.title));
    console.log('');
    console.log(chalk.gray(`   City:      `) + chalk.white(event.city));
    console.log(chalk.gray(`   Date:      `) + chalk.white(event.date) + chalk.gray(` (${leadDaysStr})`));
    console.log(chalk.gray(`   Bins:      `) + chalk.white(`${event.bins.length} temperature ranges`));
    console.log('');
    console.log(chalk.gray('   Temperature Bins:'));

    for (const bin of event.bins) {
        const priceStr = bin.price > 0
            ? chalk.yellow(`${(bin.price * 100).toFixed(1)}¢`)
            : chalk.gray('--¢');
        const binLabel = bin.label.padEnd(12);
        console.log(chalk.gray(`     `) + chalk.white(binLabel) + chalk.gray(' │ ') + priceStr);
    }

    console.log('');
    console.log(chalk.gray('   📍 ') + chalk.blue.underline(`https://polymarket.com/event/${event.slug}`));
}

/**
 * Main discovery function
 */
async function discoverAndDisplay(): Promise<void> {
    console.log('');
    console.log(chalk.cyan('━'.repeat(65)));
    console.log(chalk.cyan.bold('  🌡️  POLYMARKET WEATHER MARKET DISCOVERY'));
    console.log(chalk.cyan('━'.repeat(65)));
    console.log('');

    console.log(chalk.blue('ℹ'), 'Fetching weather events from Polymarket (tag_id=84)...');

    // Fetch weather events
    const allEvents = await fetchWeatherEvents();
    console.log(chalk.blue('ℹ'), `Found ${allEvents.length} weather-related events`);

    // Process into temperature events
    const temperatureEvents = processTemperatureEvents(allEvents);

    // Display results
    console.log('');
    if (temperatureEvents.length === 0) {
        console.log(chalk.yellow('⚠'), 'No temperature prediction markets found');
        console.log('');
        console.log(chalk.gray('This could mean:'));
        console.log(chalk.gray('  • No active temperature markets exist'));
        console.log(chalk.gray('  • Markets have different title format'));
        console.log('');

        // Show what we did find
        const otherWeather = allEvents.filter(e => e.active && !e.closed).slice(0, 10);
        if (otherWeather.length > 0) {
            console.log(chalk.gray('Other weather events found:'));
            for (const e of otherWeather) {
                console.log(chalk.gray(`  • ${e.title}`));
            }
        }
    } else {
        console.log(chalk.green('✓'), chalk.green.bold(`Discovered ${temperatureEvents.length} temperature market(s)`));

        // Group by city
        const byCity = new Map<string, TemperatureEvent[]>();
        for (const event of temperatureEvents) {
            if (!byCity.has(event.city)) {
                byCity.set(event.city, []);
            }
            byCity.get(event.city)!.push(event);
        }

        // Display markets grouped by city
        let marketIndex = 1;
        for (const [city, events] of byCity) {
            console.log('');
            console.log(chalk.magenta.bold(`📍 ${city.toUpperCase()}`));
            for (const event of events) {
                displayEvent(event, marketIndex++);
            }
        }
    }

    console.log('');
    console.log(chalk.cyan('━'.repeat(65)));
    console.log(chalk.green('✓'), 'Discovery complete');
    console.log(chalk.cyan('━'.repeat(65)));
    console.log('');
}

// Run the discovery
discoverAndDisplay().catch((error) => {
    console.error(chalk.red('✗'), 'Error during discovery:', error.message);
    process.exit(1);
});
