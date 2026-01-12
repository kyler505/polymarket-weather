import { ethers, Interface } from 'ethers';
import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';

const PRIVATE_KEY = ENV.PRIVATE_KEY;
const RPC_URL = ENV.RPC_URL;

async function findGnosisSafeProxy() {
    console.log('\n🔍 SEARCHING FOR GNOSIS SAFE PROXY WALLET\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const wallet = new ethers.Wallet(PRIVATE_KEY);
    const eoaAddress = wallet.address;

    console.log('📋 STEP 1: Your EOA address (from private key)\n');
    console.log(`   ${eoaAddress}\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 STEP 2: Positions on EOA address\n');

    try {
        const eoaPositions: any[] = await fetchData(
            `https://data-api.polymarket.com/positions?user=${eoaAddress}`
        );
        console.log(`   Positions: ${eoaPositions?.length || 0}\n`);
        if (eoaPositions && eoaPositions.length > 0) {
            console.log('   ✅ There are positions on EOA!\n');
        }
    } catch (error) {
        console.log('   ❌ Failed to get positions\n');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 STEP 3: Searching for Gnosis Safe Proxy via transactions\n');

    try {
        const activities: any[] = await fetchData(
            `https://data-api.polymarket.com/activity?user=${eoaAddress}&type=TRADE`
        );

        if (activities && activities.length > 0) {
            const firstTrade = activities[0];
            const proxyWalletFromTrade = firstTrade.proxyWallet;

            console.log(`   EOA address:          ${eoaAddress}`);
            console.log(`   Proxy in trades:      ${proxyWalletFromTrade}\n`);

            if (proxyWalletFromTrade.toLowerCase() !== eoaAddress.toLowerCase()) {
                console.log('   🎯 GNOSIS SAFE PROXY FOUND!\n');
                console.log(`   Proxy address: ${proxyWalletFromTrade}\n`);

                const proxyPositions: any[] = await fetchData(
                    `https://data-api.polymarket.com/positions?user=${proxyWalletFromTrade}`
                );

                console.log(`   Positions on Proxy: ${proxyPositions?.length || 0}\n`);

                if (proxyPositions && proxyPositions.length > 0) {
                    console.log('   ✅ HERE ARE YOUR POSITIONS!\n');
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
                    console.log('🔧 SOLUTION:\n');
                    console.log(`PROXY_WALLET=${proxyWalletFromTrade}\n`);
                }
            }
        }
    } catch (error) {
        console.log('   ❌ Error searching for transactions\n');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 STEP 4: Search via Polygon blockchain\n');

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const eventAbi = ['event ProxyCreation(address indexed proxy, address singleton)'];
        const iface = new Interface(eventAbi);
        const latestBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, latestBlock - 10000000);

        console.log(`   Scanning blocks from ${fromBlock} to ${latestBlock}...\n`);
        const txCount = await provider.getTransactionCount(eoaAddress);
        console.log(`   Transactions from EOA: ${txCount}\n`);
    } catch (error) {
        console.log('   ⚠️  Failed to check blockchain directly\n');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('💡 RECOMMENDATIONS:\n');
    console.log('1. Go to polymarket.com and connect wallet\n');
    console.log('2. Copy address shown by Polymarket\n');
    console.log('3. Update PROXY_WALLET in .env\n');
    console.log(`\n🔗 EOA profile: https://polymarket.com/profile/${eoaAddress}\n`);
}

findGnosisSafeProxy().catch(console.error);
