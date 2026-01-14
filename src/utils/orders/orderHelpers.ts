/**
 * Shared Order Helpers
 * Common constants and utilities for order execution
 */

import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import Logger from '../logger';
import { exponentialBackoff, sleep, triggerRateLimitCooldown } from '../rateLimiter';
import { extractOrderError, isInsufficientBalanceOrAllowanceError, isRateLimitError } from './orderErrors';

// Polymarket minimum order sizes
export const MIN_ORDER_SIZE_USD = 1.0;    // Minimum order size in USD for BUY orders
export const MIN_ORDER_SIZE_TOKENS = 1.0; // Minimum order size in tokens for SELL/MERGE orders

export interface OrderResult {
    success: boolean;
    totalExecuted: number;
    abortedDueToFunds: boolean;
    retryLimitReached: boolean;
}

export interface OrderBookEntry {
    price: string;
    size: string;
}

/**
 * Find best ask (lowest price) from order book
 */
export const getBestAsk = (asks: OrderBookEntry[]): OrderBookEntry | null => {
    if (!asks || asks.length === 0) return null;
    return asks.reduce((min, ask) => {
        return parseFloat(ask.price) < parseFloat(min.price) ? ask : min;
    }, asks[0]);
};

/**
 * Find best bid (highest price) from order book
 */
export const getBestBid = (bids: OrderBookEntry[]): OrderBookEntry | null => {
    if (!bids || bids.length === 0) return null;
    return bids.reduce((max, bid) => {
        return parseFloat(bid.price) > parseFloat(max.price) ? bid : max;
    }, bids[0]);
};

/**
 * Execute order with retry logic
 */
export const executeOrderWithRetry = async (
    clobClient: ClobClient,
    orderArgs: { side: Side; tokenID: string; amount: number; price: number },
    retryLimit: number,
    onRetry?: (attempt: number, errorMessage: string | undefined) => void
): Promise<{ success: boolean; errorMessage?: string; isRateLimit: boolean; isInsufficientFunds: boolean }> => {
    const signedOrder = await clobClient.createMarketOrder(orderArgs);
    const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);

    if (resp.success === true) {
        return { success: true, isRateLimit: false, isInsufficientFunds: false };
    }

    const errorMessage = extractOrderError(resp);

    if (isInsufficientBalanceOrAllowanceError(errorMessage)) {
        return { success: false, errorMessage, isRateLimit: false, isInsufficientFunds: true };
    }

    if (isRateLimitError(errorMessage)) {
        triggerRateLimitCooldown();
        return { success: false, errorMessage, isRateLimit: true, isInsufficientFunds: false };
    }

    return { success: false, errorMessage, isRateLimit: false, isInsufficientFunds: false };
};

/**
 * Wait with exponential backoff before retry
 */
export const waitForRetry = async (retryAttempt: number): Promise<void> => {
    const backoffDelay = exponentialBackoff(retryAttempt);
    Logger.info(`⏳ Waiting ${(backoffDelay / 1000).toFixed(1)}s before retry...`);
    await sleep(backoffDelay);
};
