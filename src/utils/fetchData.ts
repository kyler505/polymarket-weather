import axios, { AxiosError } from 'axios';
import { ENV } from '../config/env';
import { isRateLimitResponse, triggerRateLimitCooldown, exponentialBackoff, addJitter } from './rateLimiter';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isNetworkError = (error: unknown): boolean => {
    if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const code = axiosError.code;
        // Network timeout/connection errors
        return (
            code === 'ETIMEDOUT' ||
            code === 'ENETUNREACH' ||
            code === 'ECONNRESET' ||
            code === 'ECONNREFUSED' ||
            !axiosError.response
        ); // No response = network issue
    }
    return false;
};

/**
 * Check if an axios error indicates rate limiting
 */
const isRateLimitAxiosError = (error: unknown): boolean => {
    if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        const data = axiosError.response?.data;

        if (status && isRateLimitResponse(status, data)) {
            return true;
        }

        // Check response data for Cloudflare block message
        if (typeof data === 'string') {
            const lower = data.toLowerCase();
            if (lower.includes('been blocked') || lower.includes('cloudflare')) {
                return true;
            }
        }
    }
    return false;
};

const fetchData = async (url: string) => {
    const retries = ENV.NETWORK_RETRY_LIMIT;
    const timeout = ENV.REQUEST_TIMEOUT_MS;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            // Add small random jitter before each request to avoid request bursts
            if (attempt > 1) {
                const jitteredDelay = addJitter(100, 0.5); // 50-150ms random delay
                await sleep(jitteredDelay);
            }

            const response = await axios.get(url, {
                timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
                // Force IPv4 to avoid IPv6 connectivity issues
                family: 4,
            });
            return response.data;
        } catch (error) {
            const isLastAttempt = attempt === retries;

            // Check for rate limiting first
            if (isRateLimitAxiosError(error)) {
                console.warn(`🚫 Rate limit detected during data fetch`);
                triggerRateLimitCooldown();
                // Don't retry on rate limit - let the cooldown mechanism handle it
                throw error;
            }

            if (isNetworkError(error) && !isLastAttempt) {
                const delay = exponentialBackoff(attempt, ENV.RETRY_DELAY_BASE_MS, ENV.RETRY_DELAY_MAX_MS);
                console.warn(
                    `⚠️  Network error (attempt ${attempt}/${retries}), retrying in ${(delay / 1000).toFixed(1)}s...`
                );
                await sleep(delay);
                continue;
            }

            // If it's the last attempt or not a network error, throw
            if (isLastAttempt && isNetworkError(error)) {
                console.error(
                    `❌ Network timeout after ${retries} attempts -`,
                    axios.isAxiosError(error) ? error.code : 'Unknown error'
                );
            }
            throw error;
        }
    }
};

export default fetchData;
