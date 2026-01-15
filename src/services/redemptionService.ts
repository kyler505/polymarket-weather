import { ethers } from 'ethers';
import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';
import Logger from '../utils/logger';

const PROXY_WALLET = ENV.PROXY_WALLET;
const PRIVATE_KEY = ENV.PRIVATE_KEY;
const RPC_URL = ENV.RPC_URL || 'https://polygon-rpc.com';

const CTF_CONTRACT_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDC_ADDRESS = ENV.USDC_CONTRACT_ADDRESS || '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

const RESOLVED_HIGH = 0.99;
const RESOLVED_LOW = 0.01;
const ZERO_THRESHOLD = 0.0001;
const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

interface Position {
    asset: string;
    conditionId: string;
    size: number;
    avgPrice: number;
    currentValue: number;
    curPrice: number;
    title?: string;
    outcome?: string;
    slug?: string;
    redeemable?: boolean;
}

const CTF_ABI = [
    'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] calldata indexSets) external',
    'function balanceOf(address owner, uint256 tokenId) external view returns (uint256)',
];

const loadPositions = async (address: string): Promise<Position[]> => {
    const url = `https://data-api.polymarket.com/positions?user=${address}`;
    const data = await fetchData(url);
    const positions = Array.isArray(data) ? (data as Position[]) : [];
    return positions.filter((pos) => (pos.size || 0) > ZERO_THRESHOLD);
};

const redeemPosition = async (
    ctfContract: ethers.Contract,
    position: Position,
    provider: ethers.JsonRpcProvider
): Promise<{ success: boolean; error?: string }> => {
    try {
        const conditionIdBytes32 = ethers.zeroPadValue(
            ethers.toBeHex(BigInt(position.conditionId)),
            32
        );
        const parentCollectionId = ethers.ZeroHash;
        // Index sets for [0, 1] outcomes (binary markets usually)
        // Note: For more complex markets, indexSets might differ, but 1, 2 is standard for binary (1=0x1, 2=0x2)
        const indexSets = [1, 2];

        Logger.info(`   Attempting redemption for ${position.title || position.conditionId}...`);

        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || feeData.maxFeePerGas;
        if (!gasPrice) throw new Error('Could not determine gas price');

        const adjustedGasPrice = (gasPrice * 120n) / 100n;

        const tx = await ctfContract.redeemPositions(
            USDC_ADDRESS, parentCollectionId, conditionIdBytes32, indexSets,
            { gasLimit: 500000, gasPrice: adjustedGasPrice }
        );

        Logger.info(`   ⏳ Transaction submitted: ${tx.hash}`);
        const receipt = await tx.wait();

        if (receipt.status === 1) {
            Logger.success(`   ✅ Redemption successful! Gas used: ${receipt.gasUsed.toString()}`);
            return { success: true };
        } else {
            return { success: false, error: 'Transaction reverted' };
        }
    } catch (error: any) {
        Logger.error(`   ❌ Redemption failed: ${error.message}`);
        return { success: false, error: error.message };
    }
};

let isRunning = false;
let timeoutId: NodeJS.Timeout | null = null;

const checkAndRedeem = async () => {
    if (!ENV.PRIVATE_KEY) {
        Logger.warning('No private key found. Redemption service cannot run.');
        return;
    }

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
        const ctfContract = new ethers.Contract(CTF_CONTRACT_ADDRESS, CTF_ABI, wallet);

        const allPositions = await loadPositions(PROXY_WALLET);

        const redeemablePositions = allPositions.filter(
            (pos) => (pos.curPrice >= RESOLVED_HIGH || pos.curPrice <= RESOLVED_LOW) && pos.redeemable === true
        );

        if (redeemablePositions.length > 0) {
            Logger.info(`💰 Redemption Service: Found ${redeemablePositions.length} redeemable positions`);

            // Group by conditionId to avoid duplicate calls for same market
            const positionsByCondition = new Map<string, Position[]>();
            redeemablePositions.forEach((pos) => {
                const existing = positionsByCondition.get(pos.conditionId) || [];
                existing.push(pos);
                positionsByCondition.set(pos.conditionId, existing);
            });

            for (const [conditionId, positions] of positionsByCondition.entries()) {
                await redeemPosition(ctfContract, positions[0], provider);
                // Small delay between transactions
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        }
    } catch (error) {
        Logger.error(`Redemption Service Error: ${error}`);
    }
};

export const startRedemptionService = () => {
    if (isRunning) return;
    isRunning = true;

    Logger.info('Starting redemption service (checks every 60 mins)...');

    // Run immediately
    checkAndRedeem();

    // Then interval
    const runLoop = async () => {
        if (!isRunning) return;
        timeoutId = setTimeout(async () => {
            await checkAndRedeem();
            runLoop();
        }, DEFAULT_CHECK_INTERVAL_MS);
    };

    runLoop();
};

export const stopRedemptionService = () => {
    isRunning = false;
    if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
    }
    Logger.info('Redemption service stopped');
};
