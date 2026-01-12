import { ethers } from 'ethers';
import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';

const PROXY_WALLET = ENV.PROXY_WALLET;
const PRIVATE_KEY = ENV.PRIVATE_KEY;
const RPC_URL = ENV.RPC_URL || 'https://polygon-rpc.com';

const CTF_CONTRACT_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

const RESOLVED_HIGH = 0.99;
const RESOLVED_LOW = 0.01;
const ZERO_THRESHOLD = 0.0001;

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
        const indexSets = [1, 2];

        console.log(`   Attempting redemption...`);
        console.log(`   Condition ID: ${conditionIdBytes32}`);

        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || feeData.maxFeePerGas;
        if (!gasPrice) throw new Error('Could not determine gas price');

        const adjustedGasPrice = (gasPrice * 120n) / 100n;
        console.log(`   Gas price: ${ethers.formatUnits(adjustedGasPrice, 'gwei')} Gwei`);

        const tx = await ctfContract.redeemPositions(
            USDC_ADDRESS, parentCollectionId, conditionIdBytes32, indexSets,
            { gasLimit: 500000, gasPrice: adjustedGasPrice }
        );

        console.log(`   ⏳ Transaction submitted: ${tx.hash}`);
        const receipt = await tx.wait();

        if (receipt.status === 1) {
            console.log(`   ✅ Redemption successful! Gas used: ${receipt.gasUsed.toString()}`);
            return { success: true };
        } else {
            return { success: false, error: 'Transaction reverted' };
        }
    } catch (error: any) {
        console.log(`   ❌ Redemption failed: ${error.message}`);
        return { success: false, error: error.message };
    }
};

const main = async () => {
    console.log('🚀 Redeeming resolved positions');
    console.log(`Wallet: ${PROXY_WALLET}`);

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log(`\n✅ Connected to Polygon RPC`);
    console.log(`Signer address: ${wallet.address}`);

    const ctfContract = new ethers.Contract(CTF_CONTRACT_ADDRESS, CTF_ABI, wallet);
    const allPositions = await loadPositions(PROXY_WALLET);

    if (allPositions.length === 0) {
        console.log('\n🎉 No open positions detected.');
        return;
    }

    const redeemablePositions = allPositions.filter(
        (pos) => (pos.curPrice >= RESOLVED_HIGH || pos.curPrice <= RESOLVED_LOW) && pos.redeemable === true
    );

    console.log(`\n📊 Total: ${allPositions.length}, Redeemable: ${redeemablePositions.length}`);

    if (redeemablePositions.length === 0) {
        console.log('\n✅ No positions to redeem.');
        return;
    }

    const positionsByCondition = new Map<string, Position[]>();
    redeemablePositions.forEach((pos) => {
        const existing = positionsByCondition.get(pos.conditionId) || [];
        existing.push(pos);
        positionsByCondition.set(pos.conditionId, existing);
    });

    let successCount = 0;
    let conditionIndex = 0;

    for (const [conditionId, positions] of positionsByCondition.entries()) {
        conditionIndex++;
        console.log(`\nCondition ${conditionIndex}/${positionsByCondition.size}: ${conditionId}`);

        const result = await redeemPosition(ctfContract, positions[0], provider);
        if (result.success) successCount++;

        if (conditionIndex < positionsByCondition.size) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }

    console.log(`\n✅ Summary: ${successCount}/${positionsByCondition.size} successful`);
};

main().then(() => process.exit(0)).catch((error) => { console.error('❌ Error:', error); process.exit(1); });
