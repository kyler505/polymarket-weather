import { ethers, JsonRpcProvider } from 'ethers';
import { AssetType, ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { SignatureType } from '@polymarket/order-utils';
import { ENV } from '../config/env';

const PROXY_WALLET = ENV.PROXY_WALLET;
const PRIVATE_KEY = ENV.PRIVATE_KEY;
const CLOB_HTTP_URL = ENV.CLOB_HTTP_URL;
const RPC_URL = ENV.RPC_URL;
const POLYGON_CHAIN_ID = 137;
const RETRY_LIMIT = ENV.RETRY_LIMIT;

const MARKET_SEARCH_QUERY = 'Maduro out in 2025';
const SELL_PERCENTAGE = 0.7;

interface Position {
    asset: string;
    conditionId: string;
    size: number;
    avgPrice: number;
    currentValue: number;
    title: string;
    outcome: string;
}

const isGnosisSafe = async (address: string, provider: JsonRpcProvider): Promise<boolean> => {
    try {
        const code = await provider.getCode(address);
        return code !== '0x';
    } catch (error) {
        console.error(`Error checking wallet type: ${error}`);
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

    let clobClient = new ClobClient(
        CLOB_HTTP_URL, POLYGON_CHAIN_ID, wallet as any, undefined,
        signatureType, isProxySafe ? PROXY_WALLET : undefined
    );

    let creds = await clobClient.createApiKey();
    if (!creds.key) { creds = await clobClient.deriveApiKey(); }

    clobClient = new ClobClient(
        CLOB_HTTP_URL, POLYGON_CHAIN_ID, wallet as any, creds,
        signatureType, isProxySafe ? PROXY_WALLET : undefined
    );

    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    return clobClient;
};

const fetchPositions = async (): Promise<Position[]> => {
    const url = `https://data-api.polymarket.com/positions?user=${PROXY_WALLET}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch positions: ${response.statusText}`);
    return response.json();
};

const findMatchingPosition = (positions: Position[], searchQuery: string): Position | undefined => {
    return positions.find((pos) => pos.title.toLowerCase().includes(searchQuery.toLowerCase()));
};

const updatePolymarketCache = async (clobClient: ClobClient, tokenId: string) => {
    try {
        console.log('🔄 Updating Polymarket balance cache for token...');
        await clobClient.updateBalanceAllowance({ asset_type: AssetType.CONDITIONAL, token_id: tokenId });
        console.log('✅ Cache updated successfully\n');
    } catch (error) {
        console.log('⚠️  Warning: Could not update cache:', error);
    }
};

const sellPosition = async (clobClient: ClobClient, position: Position, sellSize: number) => {
    let remaining = sellSize;
    let retry = 0;

    console.log(`\n🔄 Starting to sell ${sellSize.toFixed(2)} tokens (${(SELL_PERCENTAGE * 100).toFixed(0)}%)`);
    console.log(`Token ID: ${position.asset}`);
    console.log(`Market: ${position.title} - ${position.outcome}\n`);

    await updatePolymarketCache(clobClient, position.asset);

    while (remaining > 0 && retry < RETRY_LIMIT) {
        try {
            const orderBook = await clobClient.getOrderBook(position.asset);
            if (!orderBook.bids || orderBook.bids.length === 0) {
                console.log('❌ No bids available'); break;
            }

            const maxPriceBid = orderBook.bids.reduce((max, bid) =>
                parseFloat(bid.price) > parseFloat(max.price) ? bid : max, orderBook.bids[0]);

            console.log(`📊 Best bid: ${maxPriceBid.size} tokens @ $${maxPriceBid.price}`);

            const orderAmount = remaining <= parseFloat(maxPriceBid.size) ? remaining : parseFloat(maxPriceBid.size);
            const orderArgs = { side: Side.SELL, tokenID: position.asset, amount: orderAmount, price: parseFloat(maxPriceBid.price) };

            console.log(`📤 Selling ${orderAmount.toFixed(2)} tokens at $${orderArgs.price}...`);

            const signedOrder = await clobClient.createMarketOrder(orderArgs);
            const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);

            if (resp.success === true) {
                retry = 0;
                console.log(`✅ SUCCESS: Sold ${orderAmount.toFixed(2)} tokens`);
                remaining -= orderAmount;
            } else {
                retry += 1;
                console.log(`⚠️  Order failed (attempt ${retry}/${RETRY_LIMIT})`);
                if (retry < RETRY_LIMIT) await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        } catch (error) {
            retry += 1;
            console.error(`❌ Error during sell attempt ${retry}/${RETRY_LIMIT}:`, error);
            if (retry < RETRY_LIMIT) await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }

    if (remaining > 0) console.log(`\n⚠️  Could not sell all. Remaining: ${remaining.toFixed(2)}`);
    else console.log(`\n🎉 Successfully sold ${sellSize.toFixed(2)} tokens!`);
};

async function main() {
    console.log('🚀 Manual Sell Script');
    console.log(`📍 Wallet: ${PROXY_WALLET}`);
    console.log(`🔍 Searching for: "${MARKET_SEARCH_QUERY}"\n`);

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const clobClient = await createClobClient(provider);
        console.log('✅ Connected to Polymarket\n');

        const positions = await fetchPositions();
        console.log(`Found ${positions.length} position(s)\n`);

        const position = findMatchingPosition(positions, MARKET_SEARCH_QUERY);
        if (!position) {
            console.log(`❌ Position "${MARKET_SEARCH_QUERY}" not found!`);
            process.exit(1);
        }

        console.log(`✅ Position found: ${position.title} - ${position.outcome}`);
        console.log(`📌 Size: ${position.size.toFixed(2)} tokens`);

        const sellSize = position.size * SELL_PERCENTAGE;
        if (sellSize < 1.0) { console.log('❌ Sell size below minimum'); process.exit(1); }

        await sellPosition(clobClient, position, sellSize);
        console.log('\n✅ Script completed!');
    } catch (error) {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    }
}

main().then(() => process.exit(0)).catch((error) => { console.error('❌ Unhandled error:', error); process.exit(1); });
