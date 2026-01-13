/**
 * Rate Limiter Utilities
 *
 * Provides functions for managing request timing to avoid rate limiting:
 * - Random jitter to avoid predictable patterns
 * - Exponential backoff for retries
 * - Rate limit detection and cooldown management
 */

import { ENV } from '../config/env';
import Logger from './logger';

// Track rate limit state globally
let isRateLimited = false;
let rateLimitCooldownUntil = 0;

/**
 * Add random jitter to a base delay value
 * @param baseMs Base delay in milliseconds
 * @param jitterPercent Percentage of jitter (e.g., 0.25 = ±25%)
 * @returns Delayed value with random jitter applied
 */
export const addJitter = (baseMs: number, jitterPercent: number = 0.25): number => {
    const jitterRange = baseMs * jitterPercent;
    const jitter = (Math.random() * 2 - 1) * jitterRange; // Random between -jitterRange and +jitterRange
    return Math.max(100, Math.round(baseMs + jitter)); // Minimum 100ms
};

/**
 * Calculate exponential backoff delay
 * @param attempt Current attempt number (1-based)
 * @param baseMs Base delay in milliseconds
 * @param maxMs Maximum delay in milliseconds
 * @returns Delay in milliseconds with exponential growth
 */
export const exponentialBackoff = (
    attempt: number,
    baseMs: number = ENV.RETRY_DELAY_BASE_MS,
    maxMs: number = ENV.RETRY_DELAY_MAX_MS
): number => {
    const delay = baseMs * Math.pow(2, attempt - 1);
    const cappedDelay = Math.min(delay, maxMs);
    // Add jitter to avoid thundering herd
    return addJitter(cappedDelay, 0.2);
};

/**
 * Sleep for a specified duration
 */
export const sleep = (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Sleep with jitter applied
 */
export const sleepWithJitter = async (baseMs: number, jitterPercent: number = 0.25): Promise<void> => {
    const delay = addJitter(baseMs, jitterPercent);
    await sleep(delay);
};

/**
 * Check if a response indicates rate limiting
 * @param status HTTP status code
 * @param responseData Response body (may contain Cloudflare block message)
 * @returns True if this appears to be a rate limit response
 */
export const isRateLimitResponse = (status: number, responseData?: unknown): boolean => {
    // Standard rate limit status codes
    if (status === 429 || status === 403) {
        // Check for Cloudflare block message
        if (typeof responseData === 'string') {
            const lower = responseData.toLowerCase();
            if (
                lower.includes('been blocked') ||
                lower.includes('cloudflare') ||
                lower.includes('rate limit') ||
                lower.includes('too many requests')
            ) {
                return true;
            }
        }
        // 403 with no data might be a block
        if (status === 403) {
            return true;
        }
    }
    return false;
};

/**
 * Trigger rate limit cooldown
 * Call this when a rate limit response is detected
 */
export const triggerRateLimitCooldown = (): void => {
    isRateLimited = true;
    rateLimitCooldownUntil = Date.now() + ENV.RATE_LIMIT_COOLDOWN_MS;
    Logger.warning(
        `🚫 Rate limit detected! Entering cooldown for ${ENV.RATE_LIMIT_COOLDOWN_MS / 1000}s`
    );
};

/**
 * Check if we're currently in rate limit cooldown
 * @returns True if still in cooldown period
 */
export const isInCooldown = (): boolean => {
    if (!isRateLimited) {
        return false;
    }

    if (Date.now() >= rateLimitCooldownUntil) {
        // Cooldown expired
        isRateLimited = false;
        Logger.info('✅ Rate limit cooldown expired, resuming operations');
        return false;
    }

    return true;
};

/**
 * Get remaining cooldown time in milliseconds
 */
export const getRemainingCooldown = (): number => {
    if (!isRateLimited) {
        return 0;
    }
    return Math.max(0, rateLimitCooldownUntil - Date.now());
};

/**
 * Wait for cooldown to expire (use in loops)
 * @returns True if was in cooldown and waited, false if no cooldown needed
 */
export const waitForCooldown = async (): Promise<boolean> => {
    if (!isInCooldown()) {
        return false;
    }

    const remaining = getRemainingCooldown();
    if (remaining > 0) {
        Logger.info(`⏳ Waiting ${Math.ceil(remaining / 1000)}s for rate limit cooldown...`);
        await sleep(remaining);
    }

    isRateLimited = false;
    Logger.info('✅ Rate limit cooldown expired, resuming operations');
    return true;
};

/**
 * Reset rate limit state (for testing or manual reset)
 */
export const resetRateLimitState = (): void => {
    isRateLimited = false;
    rateLimitCooldownUntil = 0;
};

export default {
    addJitter,
    exponentialBackoff,
    sleep,
    sleepWithJitter,
    isRateLimitResponse,
    triggerRateLimitCooldown,
    isInCooldown,
    getRemainingCooldown,
    waitForCooldown,
    resetRateLimitState,
};
