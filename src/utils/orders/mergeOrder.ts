/**
 * Merge Order Execution
 * Handles MERGE strategy for closing positions with complementary tokens
 */

import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { UserPositionInterface, UserActivityInterface } from '../../interfaces/User';
import { getUserActivityModel } from '../../models/userHistory';
import Logger from '../logger';
import refreshPolymarketCache from '../refreshPolymarketCache';
import { ENV } from '../../config/env';
import { MIN_ORDER_SIZE_TOKENS, getBestBid, waitForRetry } from './orderHelpers';
import { extractOrderError, isInsufficientBalanceOrAllowanceError, isRateLimitError } from './orderErrors';
import { triggerRateLimitCooldown } from '../rateLimiter';

const RETRY_LIMIT = ENV.RETRY_LIMIT;

export interface MergeOrderParams {
    clobClient: ClobClient;
    myPosition: UserPositionInterface | undefined;
    trade: UserActivityInterface;
    userAddress: string;
}

export interface MergeOrderResult {
    success: boolean;
    totalSold: number;
    abortedDueToFunds: boolean;
    retryLimitReached: boolean;
}

/**
 * Execute a MERGE order strategy
 * Sells all tokens of a position to close it
 */
export const executeMergeOrder = async ({
    clobClient,
    myPosition,
    trade,
    userAddress,
}: MergeOrderParams): Promise<MergeOrderResult> => {
    const UserActivity = getUserActivityModel(userAddress);

    Logger.info('Executing MERGE strategy...');

    if (!myPosition) {
        Logger.warning('No position to merge');
        await UserActivity.updateOne({ _id: trade._id }, { bot: true });
        return { success: true, totalSold: 0, abortedDueToFunds: false, retryLimitReached: false };
    }

    let remaining = myPosition.size;

    // Check minimum order size
    if (remaining < MIN_ORDER_SIZE_TOKENS) {
        Logger.warning(
            `Position size (${remaining.toFixed(2)} tokens) too small to merge - skipping`
        );
        await UserActivity.updateOne({ _id: trade._id }, { bot: true });
        return { success: true, totalSold: 0, abortedDueToFunds: false, retryLimitReached: false };
    }

    // Refresh Polymarket cache before trading
    await refreshPolymarketCache(trade.asset);

    let retry = 0;
    let abortDueToFunds = false;
    let totalSold = 0;

    while (remaining > 0 && retry < RETRY_LIMIT) {
        const orderBook = await clobClient.getOrderBook(trade.asset);
        const bestBid = getBestBid(orderBook.bids || []);

        if (!bestBid) {
            Logger.warning('No bids available in order book');
            await UserActivity.updateOne({ _id: trade._id }, { bot: true });
            break;
        }

        Logger.info(`Best bid: ${bestBid.size} @ $${bestBid.price}`);

        const sellAmount = Math.min(remaining, parseFloat(bestBid.size));
        const orderArgs = {
            side: Side.SELL,
            tokenID: myPosition.asset,
            amount: sellAmount,
            price: parseFloat(bestBid.price),
        };

        const signedOrder = await clobClient.createMarketOrder(orderArgs);
        const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);

        if (resp.success === true) {
            retry = 0;
            totalSold += orderArgs.amount;
            Logger.orderResult(true, `Sold ${orderArgs.amount} tokens at $${orderArgs.price}`);
            remaining -= orderArgs.amount;
        } else {
            const errorMessage = extractOrderError(resp);

            if (isInsufficientBalanceOrAllowanceError(errorMessage)) {
                abortDueToFunds = true;
                Logger.warning(`Order rejected: ${errorMessage || 'Insufficient balance or allowance'}`);
                Logger.warning('Skipping remaining attempts. Top up funds or run `npm run check-allowance` before retrying.');
                break;
            }

            if (isRateLimitError(errorMessage)) {
                Logger.warning(`🚫 Rate limit detected in order response`);
                triggerRateLimitCooldown();
                break;
            }

            retry += 1;
            Logger.warning(`Order failed (attempt ${retry}/${RETRY_LIMIT})${errorMessage ? ` - ${errorMessage}` : ''}`);

            if (retry < RETRY_LIMIT) {
                await waitForRetry(retry);
            }
        }
    }

    // Update database
    if (abortDueToFunds) {
        await UserActivity.updateOne({ _id: trade._id }, { bot: true, botExcutedTime: RETRY_LIMIT });
        return { success: false, totalSold, abortedDueToFunds: true, retryLimitReached: false };
    }

    if (retry >= RETRY_LIMIT) {
        await UserActivity.updateOne({ _id: trade._id }, { bot: true, botExcutedTime: retry });
        return { success: false, totalSold, abortedDueToFunds: false, retryLimitReached: true };
    }

    await UserActivity.updateOne({ _id: trade._id }, { bot: true });
    return { success: true, totalSold, abortedDueToFunds: false, retryLimitReached: false };
};
