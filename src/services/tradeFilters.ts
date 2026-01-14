/**
 * Trade Filters Module
 * Pre-trade filtering to improve trade quality and reduce portfolio concentration risk
 */

import { ENV } from '../config/env';
import { UserActivityInterface, UserPositionInterface } from '../interfaces/User';
import Logger from '../utils/logger';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Price band filter config
const PRICE_BAND_ENABLED = ENV.FILTER_PRICE_BAND_ENABLED ?? true;
const PRICE_MIN = ENV.FILTER_PRICE_MIN ?? 0.20;
const PRICE_MAX = ENV.FILTER_PRICE_MAX ?? 0.80;

// Market deduplication config
const MARKET_DEDUP_ENABLED = ENV.FILTER_MARKET_DEDUP_ENABLED ?? true;

// Theme/category cap config
const THEME_CAP_ENABLED = ENV.FILTER_THEME_CAP_ENABLED ?? true;
const THEME_CAP_PERCENT = ENV.FILTER_THEME_CAP_PERCENT ?? 30;

// ============================================================================
// STATE TRACKING
// ============================================================================

// Track copied markets per wallet: Key = "walletAddress:conditionId"
const copiedMarketsPerWallet: Map<string, Set<string>> = new Map();

// Bitcoin-related keywords for theme detection
const BITCOIN_KEYWORDS = ['btc', 'bitcoin'];

// ============================================================================
// FILTER FUNCTIONS
// ============================================================================

/**
 * Check if price is within acceptable band (excludes lottery tickets and near-certainties)
 */
export const isPriceInBand = (price: number): boolean => {
    if (!PRICE_BAND_ENABLED) return true;
    return price >= PRICE_MIN && price <= PRICE_MAX;
};

/**
 * Check if this market has already been copied from this specific wallet
 */
export const isNewMarketForWallet = (conditionId: string, walletAddress: string): boolean => {
    if (!MARKET_DEDUP_ENABLED) return true;

    const walletMarkets = copiedMarketsPerWallet.get(walletAddress);
    if (!walletMarkets) return true;

    return !walletMarkets.has(conditionId);
};

/**
 * Record that a market has been copied from a specific wallet
 */
export const recordCopiedMarket = (conditionId: string, walletAddress: string): void => {
    let walletMarkets = copiedMarketsPerWallet.get(walletAddress);
    if (!walletMarkets) {
        walletMarkets = new Set();
        copiedMarketsPerWallet.set(walletAddress, walletMarkets);
    }
    walletMarkets.add(conditionId);
};

/**
 * Detect if a trade is Bitcoin-related based on slug/eventSlug
 */
export const isBitcoinRelated = (slug?: string, eventSlug?: string): boolean => {
    const text = `${slug || ''} ${eventSlug || ''}`.toLowerCase();
    return BITCOIN_KEYWORDS.some(keyword => text.includes(keyword));
};

/**
 * Calculate current theme/category exposure as percentage of portfolio
 */
export const calculateThemeExposure = (
    positions: UserPositionInterface[],
    themeChecker: (slug?: string, eventSlug?: string) => boolean
): number => {
    if (positions.length === 0) return 0;

    const totalValue = positions.reduce((sum, p) => sum + (p.currentValue || 0), 0);
    if (totalValue === 0) return 0;

    const themeValue = positions
        .filter(p => themeChecker(p.slug, p.eventSlug))
        .reduce((sum, p) => sum + (p.currentValue || 0), 0);

    return (themeValue / totalValue) * 100;
};

/**
 * Check if adding this trade would exceed theme cap
 */
export const isBelowThemeCap = (
    slug: string | undefined,
    eventSlug: string | undefined,
    positions: UserPositionInterface[]
): { allowed: boolean; currentExposure: number } => {
    if (!THEME_CAP_ENABLED) return { allowed: true, currentExposure: 0 };

    // Currently only checking Bitcoin concentration
    if (!isBitcoinRelated(slug, eventSlug)) {
        return { allowed: true, currentExposure: 0 };
    }

    const currentExposure = calculateThemeExposure(positions, isBitcoinRelated);
    return {
        allowed: currentExposure < THEME_CAP_PERCENT,
        currentExposure
    };
};

// ============================================================================
// MAIN FILTER FUNCTION
// ============================================================================

export interface FilterResult {
    copy: boolean;
    reason?: string;
}

/**
 * Main filter function - checks all pre-trade filters
 * Returns whether the trade should be copied and reason if blocked
 */
export const shouldCopyTrade = (
    trade: Pick<UserActivityInterface, 'price' | 'conditionId' | 'slug' | 'eventSlug'>,
    walletAddress: string,
    myPositions: UserPositionInterface[]
): FilterResult => {
    // 1. Price band filter
    if (!isPriceInBand(trade.price)) {
        return {
            copy: false,
            reason: `Price ${trade.price.toFixed(2)} outside band [${PRICE_MIN}, ${PRICE_MAX}]`
        };
    }

    // 2. Per-wallet market deduplication
    if (!isNewMarketForWallet(trade.conditionId, walletAddress)) {
        return {
            copy: false,
            reason: `Already copied market ${trade.slug || trade.conditionId} from wallet ${walletAddress.slice(0, 6)}...`
        };
    }

    // 3. Theme/category cap (Bitcoin concentration)
    const themeCheck = isBelowThemeCap(trade.slug, trade.eventSlug, myPositions);
    if (!themeCheck.allowed) {
        return {
            copy: false,
            reason: `BTC exposure ${themeCheck.currentExposure.toFixed(0)}% exceeds ${THEME_CAP_PERCENT}% cap`
        };
    }

    return { copy: true };
};

/**
 * Log filter configuration at startup
 */
export const logFilterConfig = (): void => {
    Logger.info('📋 Trade Filters Configuration:');
    Logger.info(`   Price Band: ${PRICE_BAND_ENABLED ? `${PRICE_MIN}-${PRICE_MAX}` : 'DISABLED'}`);
    Logger.info(`   Market Dedup: ${MARKET_DEDUP_ENABLED ? 'ENABLED' : 'DISABLED'}`);
    Logger.info(`   Theme Cap: ${THEME_CAP_ENABLED ? `${THEME_CAP_PERCENT}%` : 'DISABLED'}`);
};
