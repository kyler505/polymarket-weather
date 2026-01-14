/**
 * Sell Order Execution
 * Handles SELL strategy for copying trader's sell orders
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
import { getBotPosition, reduceBotPosition } from '../../models/botPositions';

const RETRY_LIMIT = ENV.RETRY_LIMIT;


export interface SellOrderParams {
    clobClient: ClobClient;
    myPosition: UserPositionInterface | undefined;
    userPosition: UserPositionInterface | undefined;
    trade: UserActivityInterface;
    userAddress: string;
}

export interface SellOrderResult {
    success: boolean;
    totalSold: number;
    abortedDueToFunds: boolean;
    retryLimitReached: boolean;
}

/**
 * Execute a SELL order strategy
 */
export const executeSellOrder = async ({
    clobClient,
    myPosition,
    userPosition,
    trade,
    userAddress,
}: SellOrderParams): Promise<SellOrderResult> => {
    const UserActivity = getUserActivityModel(userAddress);

    Logger.info('Executing SELL strategy...');

    if (!myPosition) {
        Logger.warning('No position to sell');
        await UserActivity.updateOne({ _id: trade._id }, { bot: true });
        return { success: true, totalSold: 0, abortedDueToFunds: false, retryLimitReached: false };
    }

    // Try to get tracked position from new system first
    let totalBoughtTokens = 0;
    try {
        const trackedPosition = await getBotPosition(trade.conditionId);
        if (trackedPosition && trackedPosition.tokensHeld > 0) {
            totalBoughtTokens = trackedPosition.tokensHeld;
            Logger.info(`📊 Found tracked position: ${totalBoughtTokens.toFixed(2)} tokens`);
        }
    } catch (err) {
        // Fall back to legacy tracking
    }

    // Fall back to legacy tracking if new system has no data
    if (totalBoughtTokens === 0) {
        const previousBuys = await UserActivity.find({
            asset: trade.asset,
            conditionId: trade.conditionId,
            side: 'BUY',
            bot: true,
            myBoughtSize: { $exists: true, $gt: 0 },
        }).exec();

        totalBoughtTokens = previousBuys.reduce(
            (sum, buy) => sum + (buy.myBoughtSize || 0),
            0
        );

        if (totalBoughtTokens > 0) {
            Logger.info(`📊 Found ${previousBuys.length} previous purchases (legacy): ${totalBoughtTokens.toFixed(2)} tokens`);
        }
    }

    let remaining = 0;

    if (!userPosition) {
        // Trader sold entire position - we sell entire position too
        remaining = myPosition.size;
        Logger.info(`Trader closed entire position → Selling all your ${remaining.toFixed(2)} tokens`);
    } else {
        // Calculate the % of position the trader is selling
        const trader_sell_percent = trade.size / (userPosition.size + trade.size);
        const trader_position_before = userPosition.size + trade.size;

        Logger.info(`Position comparison: Trader has ${trader_position_before.toFixed(2)} tokens, You have ${myPosition.size.toFixed(2)} tokens`);
        Logger.info(`Trader selling: ${trade.size.toFixed(2)} tokens (${(trader_sell_percent * 100).toFixed(2)}% of their position)`);

        // Use tracked bought tokens if available, otherwise fallback to current position
        let baseSellSize;
        if (totalBoughtTokens > 0) {
            baseSellSize = totalBoughtTokens * trader_sell_percent;
            Logger.info(`Comparing to tracked purchases: ${totalBoughtTokens.toFixed(2)} × ${(trader_sell_percent * 100).toFixed(2)}% = ${baseSellSize.toFixed(2)} tokens`);
        } else {
            baseSellSize = myPosition.size * trader_sell_percent;
            Logger.warning(`No tracked purchases found, using current position: ${myPosition.size.toFixed(2)} × ${(trader_sell_percent * 100).toFixed(2)}% = ${baseSellSize.toFixed(2)} tokens`);
        }

        // We do NOT apply the multiplier here because we are selling a percentage of OUR position.
        // The multiplier was already applied when we entered the position.
        // Applying it again would cause us to sell disproportionately more/less.
        remaining = baseSellSize;
    }

    // Check minimum order size
    if (remaining < MIN_ORDER_SIZE_TOKENS) {
        Logger.warning(`❌ Cannot execute: Sell amount ${remaining.toFixed(2)} tokens below minimum (${MIN_ORDER_SIZE_TOKENS} token)`);
        Logger.warning(`💡 This happens when position sizes are too small or mismatched`);
        await UserActivity.updateOne({ _id: trade._id }, { bot: true });
        return { success: true, totalSold: 0, abortedDueToFunds: false, retryLimitReached: false };
    }

    // Cap sell amount to available position size
    if (remaining > myPosition.size) {
        Logger.warning(`⚠️  Calculated sell ${remaining.toFixed(2)} tokens > Your position ${myPosition.size.toFixed(2)} tokens`);
        Logger.warning(`Capping to maximum available: ${myPosition.size.toFixed(2)} tokens`);
        remaining = myPosition.size;
    }

    // Refresh Polymarket cache before trading
    await refreshPolymarketCache(trade.asset);

    let retry = 0;
    let abortDueToFunds = false;
    let totalSoldTokens = 0;

    while (remaining > 0 && retry < RETRY_LIMIT) {
        const orderBook = await clobClient.getOrderBook(trade.asset);
        const bestBid = getBestBid(orderBook.bids || []);

        if (!bestBid) {
            Logger.warning('No bids available in order book');
            await UserActivity.updateOne({ _id: trade._id }, { bot: true });
            break;
        }

        Logger.info(`Best bid: ${bestBid.size} @ $${bestBid.price}`);

        // Check if remaining amount is below minimum
        if (remaining < MIN_ORDER_SIZE_TOKENS) {
            Logger.info(`Remaining amount (${remaining.toFixed(2)} tokens) below minimum - completing trade`);
            await UserActivity.updateOne({ _id: trade._id }, { bot: true });
            break;
        }

        const sellAmount = Math.min(remaining, parseFloat(bestBid.size));

        // Final check: don't create orders below minimum
        if (sellAmount < MIN_ORDER_SIZE_TOKENS) {
            Logger.info(`Order amount (${sellAmount.toFixed(2)} tokens) below minimum - completing trade`);
            await UserActivity.updateOne({ _id: trade._id }, { bot: true });
            break;
        }

        const orderArgs = {
            side: Side.SELL,
            tokenID: trade.asset,
            amount: sellAmount,
            price: parseFloat(bestBid.price),
        };

        const signedOrder = await clobClient.createMarketOrder(orderArgs);
        const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);

        if (resp.success === true) {
            retry = 0;
            totalSoldTokens += orderArgs.amount;
            Logger.orderResult(true, `Sold ${orderArgs.amount} tokens at $${orderArgs.price}`);
            remaining -= orderArgs.amount;

            // Update position tracking
            try {
                await reduceBotPosition(trade.conditionId, orderArgs.amount, orderArgs.amount * orderArgs.price);
            } catch (err) {
                Logger.warning(`Failed to update position tracking: ${err}`);
            }
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

    // Update legacy tracking (for backwards compatibility)
    if (totalSoldTokens > 0 && totalBoughtTokens > 0) {
        const sellPercentage = totalSoldTokens / totalBoughtTokens;

        if (sellPercentage >= 0.99) {
            await UserActivity.updateMany(
                {
                    asset: trade.asset,
                    conditionId: trade.conditionId,
                    side: 'BUY',
                    bot: true,
                    myBoughtSize: { $exists: true, $gt: 0 },
                },
                { $set: { myBoughtSize: 0 } }
            );
            Logger.info(`🧹 Cleared purchase tracking (sold ${(sellPercentage * 100).toFixed(1)}% of position)`);
        } else {
            // Partial sell - reduce tracked purchases proportionally
            const previousBuys = await UserActivity.find({
                asset: trade.asset,
                conditionId: trade.conditionId,
                side: 'BUY',
                bot: true,
                myBoughtSize: { $exists: true, $gt: 0 },
            }).exec();

            for (const buy of previousBuys) {
                const newSize = (buy.myBoughtSize || 0) * (1 - sellPercentage);
                await UserActivity.updateOne({ _id: buy._id }, { $set: { myBoughtSize: newSize } });
            }
            Logger.info(`📝 Updated purchase tracking (sold ${(sellPercentage * 100).toFixed(1)}% of tracked position)`);
        }
    }

    // Update database
    if (abortDueToFunds) {
        await UserActivity.updateOne({ _id: trade._id }, { bot: true, botExcutedTime: RETRY_LIMIT });
        return { success: false, totalSold: totalSoldTokens, abortedDueToFunds: true, retryLimitReached: false };
    }

    if (retry >= RETRY_LIMIT) {
        await UserActivity.updateOne({ _id: trade._id }, { bot: true, botExcutedTime: retry });
        return { success: false, totalSold: totalSoldTokens, abortedDueToFunds: false, retryLimitReached: true };
    }

    await UserActivity.updateOne({ _id: trade._id }, { bot: true });
    return { success: true, totalSold: totalSoldTokens, abortedDueToFunds: false, retryLimitReached: false };
};
