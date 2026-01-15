/**
 * Weather Configuration
 * Station mappings and weather-specific constants
 */

import { StationMapping } from '../interfaces/WeatherMarket';

/**
 * Known weather station mappings
 * Maps station IDs (ICAO codes) to metadata for resolution
 */
export const STATION_MAPPINGS: Map<string, StationMapping> = new Map([
    ['KLGA', {
        id: 'KLGA',
        name: 'LaGuardia Airport',
        city: 'New York City',
        region: 'NYC',
        timezone: 'America/New_York',
        wundergroundUrl: 'https://www.wunderground.com/history/daily/us/ny/new-york-city/KLGA',
        lat: 40.7772,
        lon: -73.8726,
    }],
    ['KJFK', {
        id: 'KJFK',
        name: 'John F. Kennedy International Airport',
        city: 'New York City',
        region: 'NYC',
        timezone: 'America/New_York',
        wundergroundUrl: 'https://www.wunderground.com/history/daily/us/ny/new-york-city/KJFK',
        lat: 40.6413,
        lon: -73.7781,
    }],
    ['KEWR', {
        id: 'KEWR',
        name: 'Newark Liberty International Airport',
        city: 'Newark',
        region: 'NYC',
        timezone: 'America/New_York',
        wundergroundUrl: 'https://www.wunderground.com/history/daily/us/nj/newark/KEWR',
        lat: 40.6895,
        lon: -74.1745,
    }],
    ['KORD', {
        id: 'KORD',
        name: "O'Hare International Airport",
        city: 'Chicago',
        region: 'Chicago',
        timezone: 'America/Chicago',
        wundergroundUrl: 'https://www.wunderground.com/history/daily/us/il/chicago/KORD',
        lat: 41.9742,
        lon: -87.9073,
    }],
    ['KMDW', {
        id: 'KMDW',
        name: 'Chicago Midway International Airport',
        city: 'Chicago',
        region: 'Chicago',
        timezone: 'America/Chicago',
        wundergroundUrl: 'https://www.wunderground.com/history/daily/us/il/chicago/KMDW',
        lat: 41.7868,
        lon: -87.7522,
    }],
    ['KLAX', {
        id: 'KLAX',
        name: 'Los Angeles International Airport',
        city: 'Los Angeles',
        region: 'LA',
        timezone: 'America/Los_Angeles',
        wundergroundUrl: 'https://www.wunderground.com/history/daily/us/ca/los-angeles/KLAX',
        lat: 33.9425,
        lon: -118.4081,
    }],
    ['KDFW', {
        id: 'KDFW',
        name: 'Dallas/Fort Worth International Airport',
        city: 'Dallas',
        region: 'Dallas',
        timezone: 'America/Chicago',
        wundergroundUrl: 'https://www.wunderground.com/history/daily/us/tx/dallas/KDFW',
        lat: 32.8998,
        lon: -97.0403,
    }],
    ['KDEN', {
        id: 'KDEN',
        name: 'Denver International Airport',
        city: 'Denver',
        region: 'Denver',
        timezone: 'America/Denver',
        wundergroundUrl: 'https://www.wunderground.com/history/daily/us/co/denver/KDEN',
        lat: 39.8561,
        lon: -104.6737,
    }],
    ['KPHL', {
        id: 'KPHL',
        name: 'Philadelphia International Airport',
        city: 'Philadelphia',
        region: 'Philadelphia',
        timezone: 'America/New_York',
        wundergroundUrl: 'https://www.wunderground.com/history/daily/us/pa/philadelphia/KPHL',
        lat: 39.8721,
        lon: -75.2411,
    }],
    ['KBOS', {
        id: 'KBOS',
        name: 'Boston Logan International Airport',
        city: 'Boston',
        region: 'Boston',
        timezone: 'America/New_York',
        wundergroundUrl: 'https://www.wunderground.com/history/daily/us/ma/boston/KBOS',
        lat: 42.3656,
        lon: -71.0096,
    }],
    ['KAUS', {
        id: 'KAUS',
        name: 'Austin-Bergstrom International Airport',
        city: 'Austin',
        region: 'Austin',
        timezone: 'America/Chicago',
        wundergroundUrl: 'https://www.wunderground.com/history/daily/us/tx/austin/KAUS',
        lat: 30.1975,
        lon: -97.6664,
    }],
    ['KMIA', {
        id: 'KMIA',
        name: 'Miami International Airport',
        city: 'Miami',
        region: 'Miami',
        timezone: 'America/New_York',
        wundergroundUrl: 'https://www.wunderground.com/history/daily/us/fl/miami/KMIA',
        lat: 25.7959,
        lon: -80.2870,
    }],
    ['KSFO', {
        id: 'KSFO',
        name: 'San Francisco International Airport',
        city: 'San Francisco',
        region: 'SF',
        timezone: 'America/Los_Angeles',
        wundergroundUrl: 'https://www.wunderground.com/history/daily/us/ca/san-francisco/KSFO',
        lat: 37.6213,
        lon: -122.3790,
    }],
    ['KSEA', {
        id: 'KSEA',
        name: 'Seattle-Tacoma International Airport',
        city: 'Seattle',
        region: 'Seattle',
        timezone: 'America/Los_Angeles',
        wundergroundUrl: 'https://www.wunderground.com/history/daily/us/wa/seattle/KSEA',
        lat: 47.4502,
        lon: -122.3088,
    }],
    ['KATL', {
        id: 'KATL',
        name: 'Hartsfield-Jackson Atlanta International Airport',
        city: 'Atlanta',
        region: 'Atlanta',
        timezone: 'America/New_York',
        wundergroundUrl: 'https://www.wunderground.com/history/daily/us/ga/atlanta/KATL',
        lat: 33.6407,
        lon: -84.4277,
    }],
]);

/**
 * Get station by ID
 */
export const getStation = (stationId: string): StationMapping | undefined => {
    return STATION_MAPPINGS.get(stationId.toUpperCase());
};

/**
 * Try to find station by name keywords
 */
export const findStationByName = (name: string): StationMapping | undefined => {
    const normalizedName = name.toLowerCase();

    for (const [, station] of STATION_MAPPINGS) {
        if (
            normalizedName.includes(station.name.toLowerCase()) ||
            normalizedName.includes(station.city.toLowerCase()) ||
            normalizedName.includes(station.id.toLowerCase())
        ) {
            return station;
        }
    }
    return undefined;
};

/**
 * Calibrated forecast sigma (standard deviation) by lead days
 * Based on historical forecast error analysis
 * These are approximate values - should be refined with real data
 */
export const FORECAST_SIGMA = {
    // Lead days -> sigma in degrees F
    0: 1.5,   // Day-of: very accurate
    1: 2.5,   // Tomorrow
    2: 3.5,   // 2 days out
    3: 4.0,   // 3 days out
    4: 4.5,
    5: 5.0,
    6: 5.5,
    7: 6.0,
    // Beyond 7 days gets increasingly uncertain
    default: 7.0,
};

/**
 * Get sigma for a given lead time
 */
export const getSigmaForLeadDays = (leadDays: number): number => {
    if (leadDays in FORECAST_SIGMA) {
        return FORECAST_SIGMA[leadDays as keyof typeof FORECAST_SIGMA];
    }
    return FORECAST_SIGMA.default;
};

/**
 * Weather data API endpoints
 */
export const WEATHER_API = {
    NOAA_FORECAST: 'https://api.weather.gov/points',
    OPEN_METEO: 'https://api.open-meteo.com/v1/forecast',
    WUNDERGROUND_HISTORY: 'https://www.wunderground.com/history/daily',
};
