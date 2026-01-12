import { ethers, JsonRpcProvider } from 'ethers';
import { AssetType, ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { SignatureType } from '@polymarket/order-utils';
import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';

const PROXY_WALLET = ENV.PROXY_WALLET;
const PRIVATE_KEY = ENV.PRIVATE_KEY;
const CLOB_HTTP_URL = ENV.CLOB_HTTP_URL;
const RPC_URL = ENV.RPC_URL;
const POLYGON_CHAIN_ID = 137;
const RETRY_LIMIT = ENV.RETRY_LIMIT;

const SELL_PERCENTAGE = 0.8;
const MIN_POSITION_VALUE = 17;

interface Position {
    asset: string;
    conditionId: string;
    size: number;
    avgPrice: number;
    initialValue: number;
    currentValue: number;
    cashPnl: number;
    percentPnl: number;
    totalBought: number;
    realizedPnl: number;
    percentRealizedPnl: number;
    curPrice: number;
    title?: string;
    slug?: string;
    outcome?: string;
}

const isGnosisSafe = async (address: string, provider: JsonRpcProvider): Promise<boolean> => {
    try {
        const code = await provider.getCode(address);
        return code !== '0x';
    } catch (error) {
        return false;
    }
};

const createClobClient = async (provider: JsonRpcProvider): Promise<ClobClient> => {
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const isProxySafe = await isGnosisSafe(PROXY_WALLET, provider);
    const signatureType = isProxySafe ? SignatureType.POLY_GNOSIS_SAFE : SignatureType.EOA;

    console.log(`Wallet type: ${isProxySafe ? 'Gnosis Safe' : 'EOA'}`);

    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    console.log = function () {};
    console.error = function () {};

    let clobClient = new ClobClient(CLOB_HTTP_URL, POLYGON_CHAIN_ID, wallet as any, undefined,
        signatureType, isProxySafe ? PROXY_WALLET : undefined);

    let creds = await clobClient.createApiKey();
    if (!creds.key) { creds = await clobClient.deriveApiKey(); }

    clobClient = new ClobClient(CLOB_HTTP_URL, POLYGON_CHAIN_ID, wallet as any, creds,
        signatureType, isProxySafe ? PROXY_WALLET : undefined);

    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    return clobClient;
};

const sellPosition = async (clobClient: ClobClient, position: Position, sellSize: number) => {
    let remaining = sellSize;
    let retry = 0;

    console.log(`\n🔄 Selling ${sellSize.toFixed(2)} tokens (${(SELL_PERCENTAGE * 100).toFixed(0)}%)`);
    await clobClient.updateBalanceAllowance({ asset_type: AssetType.CONDITIONAL, token_id: position.asset });

    while (remaining > 0 && retry < RETRY_LIMIT) {
        try {
            const orderBook = await clobClient.getOrderBook(position.asset);
            if (!orderBook.bids || orderBook.bids.length === 0) break;

            const maxPriceBid = orderBook.bids.reduce((max, bid) =>
                parseFloat(bid.price) > parseFloat(max.price) ? bid : max, orderBook.bids[0]);

            const orderAmount = remaining <= parseFloat(maxPriceBid.size) ? remaining : parseFloat(maxPriceBid.size);
            const signedOrder = await clobClient.createMarketOrder({
                side: Side.SELL, tokenID: position.asset, amount: orderAmount, price: parseFloat(maxPriceBid.price)
            });
            const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);

            if (resp.success === true) {
                retry = 0;
                console.log(`✅ Sold ${orderAmount.toFixed(2)} tokens`);
                remaining -= orderAmount;
            } else {
                retry += 1;
                if (retry < RETRY_LIMIT) await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        } catch (error) {
            retry += 1;
            if (retry < RETRY_LIMIT) await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
    return remaining <= 0;
};

async function main() {
    console.log('🚀 Sell Large Positions Script');
    console.log(`📍 Wallet: ${PROXY_WALLET}, Min value: $${MIN_POSITION_VALUE}\n`);

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const clobClient = await createClobClient(provider);

        const positions: Position[] = await fetchData(
            `https://data-api.polymarket.com/positions?user=${PROXY_WALLET}`
        );

        const largePositions = positions.filter((p) => p.currentValue > MIN_POSITION_VALUE);
        if (largePositions.length === 0) {
            console.log('✅ No large positions found.');
            process.exit(0);
        }

        largePositions.sort((a, b) => b.currentValue - a.currentValue);
        console.log(`🎯 Found ${largePositions.length} large position(s)\n`);

        let successCount = 0;
        for (let i = 0; i < largePositions.length; i++) {
            const position = largePositions[i];
            const sellSize = Math.floor(position.size * SELL_PERCENTAGE);
            console.log(`\n📦 Position ${i + 1}/${largePositions.length}: ${position.title}`);

            if (sellSize < 1.0) { continue; }
            if (await sellPosition(clobClient, position, sellSize)) successCount++;

            if (i < largePositions.length - 1) await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        console.log(`\n✅ Sold ${successCount}/${largePositions.length} positions`);
    } catch (error) {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    }
}

main().then(() => process.exit(0)).catch((error) => { console.error('❌ Error:', error); process.exit(1); });
