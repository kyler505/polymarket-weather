/**
 * Buy Order Execution
 * Handles BUY strategy for copying trader's buy orders
 */

import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { UserPositionInterface, UserActivityInterface } from '../../interfaces/User';
import { getUserActivityModel } from '../../models/userHistory';
import Logger from '../logger';
import refreshPolymarketCache from '../refreshPolymarketCache';
import { analyzeOrderBook } from '../marketAnalysis';
import { getBaseSlippageTolerance, calculateDynamicSlippage, isPriceAcceptable } from '../slippageCalculator';
import { ENV, getMultiplierForTrader } from '../../config/env';
import { calculateOrderSize } from '../../config/copyStrategy';
import { MIN_ORDER_SIZE_USD, getBestAsk, waitForRetry } from './orderHelpers';
import { extractOrderError, isInsufficientBalanceOrAllowanceError, isRateLimitError } from './orderErrors';
import { triggerRateLimitCooldown, sleep } from '../rateLimiter';
import { updateBotPosition } from '../../models/botPositions';
import { getDynamicMultiplier } from '../../services/traderAnalytics';

const RETRY_LIMIT = ENV.RETRY_LIMIT;
const COPY_STRATEGY_CONFIG = ENV.COPY_STRATEGY_CONFIG;
const WIND_DOWN_MODE = ENV.WIND_DOWN_MODE;

export interface BuyOrderParams {
    clobClient: ClobClient;
    myPosition: UserPositionInterface | undefined;
    trade: UserActivityInterface;
    myBalance: number;
    userAddress: string;
}

export interface BuyOrderResult {
    success: boolean;
    totalBought: number;
    abortedDueToFunds: boolean;
    retryLimitReached: boolean;
}

/**
 * Execute a BUY order strategy
 */
export const executeBuyOrder = async ({
    clobClient,
    myPosition,
    trade,
    myBalance,
    userAddress,
}: BuyOrderParams): Promise<BuyOrderResult> => {
    const UserActivity = getUserActivityModel(userAddress);

    // Check for wind-down mode - skip all BUY orders
    if (WIND_DOWN_MODE) {
        Logger.warning('🔻 WIND DOWN MODE: Skipping BUY order (no new positions)');
        Logger.info(`Would have bought: $${trade.usdcSize.toFixed(2)} on ${trade.slug || trade.asset}`);
        await UserActivity.updateOne({ _id: trade._id }, { bot: true });
        return { success: true, totalBought: 0, abortedDueToFunds: false, retryLimitReached: false };
    }

    // Check minimum balance
    if (myBalance < MIN_ORDER_SIZE_USD) {
        Logger.warning(`💸 LOW BALANCE: Skipping BUY (balance: $${myBalance.toFixed(2)} < $${MIN_ORDER_SIZE_USD})`);
        Logger.info(`Would have bought: $${trade.usdcSize.toFixed(2)} on ${trade.slug || trade.asset}`);
        await UserActivity.updateOne({ _id: trade._id }, { bot: true });
        return { success: true, totalBought: 0, abortedDueToFunds: false, retryLimitReached: false };
    }

    Logger.info('Executing BUY strategy...');
    Logger.info(`Your balance: $${myBalance.toFixed(2)}`);
    Logger.info(`Trader bought: $${trade.usdcSize.toFixed(2)}`);

    // Get current position size for position limit checks
    const currentPositionValue = myPosition ? myPosition.size * myPosition.avgPrice : 0;

    // Get per-trader multiplier (if configured)
    const traderMultiplier = getMultiplierForTrader(userAddress);

    // Use copy strategy system with per-trader multiplier
    const orderCalc = calculateOrderSize(
        COPY_STRATEGY_CONFIG,
        trade.usdcSize,
        myBalance,
        currentPositionValue,
        traderMultiplier !== ENV.TRADE_MULTIPLIER ? traderMultiplier : undefined
    );

    let finalAmount = orderCalc.finalAmount;

    // Apply dynamic trader scoring multiplier if enabled
    if (ENV.TRADER_SCORING_ENABLED && finalAmount > 0) {
        try {
            const dynamicMultiplier = await getDynamicMultiplier(userAddress);
            if (dynamicMultiplier !== 1.0) {
                const originalAmount = finalAmount;
                finalAmount = finalAmount * dynamicMultiplier;
                Logger.info(`📈 Dynamic Scoring: Applying ${dynamicMultiplier.toFixed(2)}x multiplier (Score-based)`);
                Logger.info(`   Size adjusted: $${originalAmount.toFixed(2)} → $${finalAmount.toFixed(2)}`);
            }
        } catch (error) {
            Logger.warning(`Failed to get dynamic multiplier: ${error}`);
        }
    }

    Logger.info(`📊 ${orderCalc.reasoning}`);

    // Check if order should be executed
    if (finalAmount === 0) {
        Logger.warning(`❌ Cannot execute: ${orderCalc.reasoning}`);
        if (orderCalc.belowMinimum) {
            Logger.warning(`💡 Increase COPY_SIZE or wait for larger trades`);
        }
        await UserActivity.updateOne({ _id: trade._id }, { bot: true });
        return { success: true, totalBought: 0, abortedDueToFunds: false, retryLimitReached: false };
    }

    // Smart round-up: if order is at least 50% of minimum, round up instead of skipping
    // This helps execute near-miss orders while avoiding truly tiny orders
    if (finalAmount > 0 && finalAmount < MIN_ORDER_SIZE_USD && finalAmount >= MIN_ORDER_SIZE_USD * 0.5) {
        Logger.info(`📈 Rounding up $${finalAmount.toFixed(2)} to minimum $${MIN_ORDER_SIZE_USD}`);
        finalAmount = MIN_ORDER_SIZE_USD;
    }

    // Final check against minimum order size (after dynamic multiplier and round-up)
    if (finalAmount < MIN_ORDER_SIZE_USD) {
        Logger.warning(`❌ Adjusted size $${finalAmount.toFixed(2)} below minimum $${MIN_ORDER_SIZE_USD}`);
        await UserActivity.updateOne({ _id: trade._id }, { bot: true });
        return { success: true, totalBought: 0, abortedDueToFunds: false, retryLimitReached: false };
    }

    let remaining = finalAmount;
    let retry = 0;
    let abortDueToFunds = false;
    let totalBoughtTokens = 0;

    while (remaining > 0 && retry < RETRY_LIMIT) {
        const orderBook = await clobClient.getOrderBook(trade.asset);
        const bestAsk = getBestAsk(orderBook.asks || []);

        if (!bestAsk) {
            Logger.warning('No asks available in order book');
            await UserActivity.updateOne({ _id: trade._id }, { bot: true });
            break;
        }

        Logger.info(`Best ask: ${bestAsk.size} @ $${bestAsk.price}`);

        // Dynamic slippage check
        const marketCondition = analyzeOrderBook(orderBook);
        const baseSlippage = getBaseSlippageTolerance(marketCondition);
        const dynamicSlippage = calculateDynamicSlippage(baseSlippage, marketCondition);

        // Apply progressive retry relaxation if enabled
        let effectiveSlippage = dynamicSlippage;
        if (ENV.SLIPPAGE_RETRY_ENABLED && retry > 0) {
            const relaxationMultiplier = 1 + (ENV.SLIPPAGE_RETRY_RELAXATION_PERCENT / 100) * retry;
            effectiveSlippage = dynamicSlippage * relaxationMultiplier;
            Logger.info(`📈 Retry ${retry}: Relaxing slippage to ${effectiveSlippage.toFixed(1)}% (was ${dynamicSlippage.toFixed(1)}%)`);
        }

        const currentPrice = parseFloat(bestAsk.price);
        if (!isPriceAcceptable(currentPrice, trade.price, effectiveSlippage)) {
            const maxAcceptablePrice = trade.price * (1 + effectiveSlippage / 100);
            Logger.warning(
                `⚠️  Price slippage too high: Current $${currentPrice.toFixed(3)} > Max $${maxAcceptablePrice.toFixed(3)} (${effectiveSlippage.toFixed(1)}% tolerance)`
            );
            Logger.info(
                `📊 Market: Spread ${marketCondition.spread.toFixed(1)}%, Depth $${marketCondition.depth.toFixed(0)}, Volatility ${marketCondition.volatility}`
            );

            if (ENV.SLIPPAGE_RETRY_ENABLED && retry < RETRY_LIMIT - 1) {
                Logger.info(`⏳ Waiting 2s before retry with relaxed slippage...`);
                await sleep(2000);
                retry++;
                continue;
            }

            Logger.warning('❌ Skipping trade after retry attempts');
            await UserActivity.updateOne({ _id: trade._id }, { bot: true });
            break;
        }

        // Check if remaining amount is below minimum
        if (remaining < MIN_ORDER_SIZE_USD) {
            Logger.info(`Remaining amount ($${remaining.toFixed(2)}) below minimum - completing trade`);
            await UserActivity.updateOne({ _id: trade._id }, { bot: true, myBoughtSize: totalBoughtTokens });
            break;
        }

        const maxOrderSize = parseFloat(bestAsk.size) * parseFloat(bestAsk.price);
        const orderSize = Math.min(remaining, maxOrderSize);

        const orderArgs = {
            side: Side.BUY,
            tokenID: trade.asset,
            amount: orderSize,
            price: parseFloat(bestAsk.price),
        };

        Logger.info(`Creating order: $${orderSize.toFixed(2)} @ $${bestAsk.price} (Balance: $${myBalance.toFixed(2)})`);

        // Refresh cache before order
        await refreshPolymarketCache(trade.asset);

        const signedOrder = await clobClient.createMarketOrder(orderArgs);
        const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);

        if (resp.success === true) {
            retry = 0;
            const tokensBought = orderArgs.amount / orderArgs.price;
            totalBoughtTokens += tokensBought;
            Logger.orderResult(true, `Bought $${orderArgs.amount.toFixed(2)} at $${orderArgs.price} (${tokensBought.toFixed(2)} tokens)`);
            remaining -= orderArgs.amount;

            // Update position tracking
            try {
                await updateBotPosition(trade.conditionId, trade.asset, tokensBought, orderArgs.amount);
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

    // Update database
    if (abortDueToFunds) {
        await UserActivity.updateOne(
            { _id: trade._id },
            { bot: true, botExcutedTime: RETRY_LIMIT, myBoughtSize: totalBoughtTokens }
        );
        return { success: false, totalBought: totalBoughtTokens, abortedDueToFunds: true, retryLimitReached: false };
    }

    if (retry >= RETRY_LIMIT) {
        await UserActivity.updateOne(
            { _id: trade._id },
            { bot: true, botExcutedTime: retry, myBoughtSize: totalBoughtTokens }
        );
        return { success: false, totalBought: totalBoughtTokens, abortedDueToFunds: false, retryLimitReached: true };
    }

    await UserActivity.updateOne({ _id: trade._id }, { bot: true, myBoughtSize: totalBoughtTokens });

    if (totalBoughtTokens > 0) {
        Logger.info(`📝 Tracked purchase: ${totalBoughtTokens.toFixed(2)} tokens for future sell calculations`);
    }

    return { success: true, totalBought: totalBoughtTokens, abortedDueToFunds: false, retryLimitReached: false };
};
