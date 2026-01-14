/**
 * Order Execution Router
 * Routes order requests to appropriate strategy handlers
 */

import { ClobClient } from '@polymarket/clob-client';
import { UserActivityInterface, UserPositionInterface } from '../../interfaces/User';
import Logger from '../logger';
import { executeBuyOrder } from './buyOrder';
import { executeSellOrder } from './sellOrder';
import { executeMergeOrder } from './mergeOrder';

// Re-export sub-modules for direct access if needed
export * from './orderErrors';
export * from './orderHelpers';
export * from './buyOrder';
export * from './sellOrder';
export * from './mergeOrder';

/**
 * Main order execution function
 * Routes to appropriate strategy based on condition
 *
 * @param clobClient - Polymarket CLOB client
 * @param condition - Order type: 'buy', 'sell', or 'merge'
 * @param my_position - Bot's current position
 * @param user_position - Trader's current position
 * @param trade - Trade activity to copy
 * @param my_balance - Bot's current USDC balance
 * @param user_balance - Trader's USDC balance (unused in most strategies)
 * @param userAddress - Trader's wallet address
 */
const postOrder = async (
    clobClient: ClobClient,
    condition: string,
    my_position: UserPositionInterface | undefined,
    user_position: UserPositionInterface | undefined,
    trade: UserActivityInterface,
    my_balance: number,
    user_balance: number,
    userAddress: string
): Promise<void> => {
    switch (condition) {
        case 'merge':
            await executeMergeOrder({
                clobClient,
                myPosition: my_position,
                trade,
                userAddress,
            });
            break;

        case 'buy':
            await executeBuyOrder({
                clobClient,
                myPosition: my_position,
                trade,
                myBalance: my_balance,
                userAddress,
            });
            break;

        case 'sell':
            await executeSellOrder({
                clobClient,
                myPosition: my_position,
                userPosition: user_position,
                trade,
                userAddress,
            });
            break;

        default:
            Logger.error(`Unknown condition: ${condition}`);
    }
};

export default postOrder;
