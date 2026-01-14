import { AssetType, ClobClient } from '@polymarket/clob-client';
import createClobClient from './createClobClient';
import Logger from './logger';

/**
 * Refreshes Polymarket's CLOB server cache for balance and allowance.
 * This prevents "not enough balance / allowance" errors due to stale cache.
 *
 * @param tokenId - Optional token ID for conditional token cache refresh
 * @returns Promise<boolean> - True if successful, false otherwise
 */
export const refreshPolymarketCache = async (tokenId?: string): Promise<boolean> => {
    try {
        const clobClient = await createClobClient();

        // Refresh collateral (USDC) cache
        const collateralParams = {
            asset_type: AssetType.COLLATERAL,
        } as const;

        await clobClient.updateBalanceAllowance(collateralParams);

        // If tokenId provided, also refresh conditional token cache
        if (tokenId) {
            const conditionalParams = {
                asset_type: AssetType.CONDITIONAL,
                token_id: tokenId,
            } as const;

            await clobClient.updateBalanceAllowance(conditionalParams);
        }

        return true;
    } catch (error: any) {
        Logger.error(`Failed to refresh Polymarket cache: ${error?.message || error}`);
        return false;
    }
};

export default refreshPolymarketCache;
