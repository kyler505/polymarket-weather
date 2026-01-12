import { ethers, EventLog } from 'ethers';
import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';

const PRIVATE_KEY = ENV.PRIVATE_KEY;
const RPC_URL = ENV.RPC_URL;

async function findRealProxyWallet() {
    console.log('\n🔍 SEARCHING FOR REAL PROXY WALLET\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const wallet = new ethers.Wallet(PRIVATE_KEY);
    const eoaAddress = wallet.address;

    console.log('📋 EOA address (from private key):\n');
    console.log(`   ${eoaAddress}\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 STEP 1: Checking username via API\n');

    try {
        const userProfile = await fetchData(`https://data-api.polymarket.com/users/${eoaAddress}`);
        console.log('   Profile data:', JSON.stringify(userProfile, null, 2), '\n');
    } catch (error) {
        console.log('   ⚠️  Failed to get profile via /users\n');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 STEP 2: Analyzing transactions on Polygon\n');

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        console.log('   Getting transaction history...\n');

        const polygonscanApiKey = 'YourApiKeyToken';
        const polygonscanUrl = `https://api.polygonscan.com/api?module=account&action=txlist&address=${eoaAddress}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc&apikey=${polygonscanApiKey}`;

        try {
            const response = await fetch(polygonscanUrl);
            const data = await response.json();

            if (data.status === '1' && data.result && data.result.length > 0) {
                console.log(`   ✅ Found transactions: ${data.result.length}\n`);
            }
        } catch (e) {
            console.log('   ⚠️  Polygonscan API unavailable\n');
        }
    } catch (error) {
        console.log('   ⚠️  Error analyzing transactions\n');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 STEP 3: Search via balance API\n');

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const USDC_ADDRESS = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174';
        const usdcAbi = [
            'function balanceOf(address owner) view returns (uint256)',
            'event Transfer(address indexed from, address indexed to, uint256 value)',
        ];

        const usdcContract = new ethers.Contract(USDC_ADDRESS, usdcAbi, provider);
        const balance: bigint = await usdcContract.balanceOf(eoaAddress);
        console.log(`   USDC on EOA: ${ethers.formatUnits(balance, 6)}\n`);

        console.log('   Searching for USDC transfers...\n');
        const latestBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, latestBlock - 1000000);

        const transferFilter = usdcContract.filters.Transfer(eoaAddress, null);
        const events = await usdcContract.queryFilter(transferFilter, fromBlock, latestBlock);

        if (events.length > 0) {
            console.log(`   ✅ Found USDC transfers: ${events.length}\n`);
            const recipients = new Set<string>();
            for (const event of events) {
                const eventLog = event as EventLog;
                if (eventLog.args && eventLog.args.to) {
                    recipients.add(eventLog.args.to.toLowerCase());
                }
            }
            console.log('   Checking recipients for positions...\n');
            for (const recipient of Array.from(recipients).slice(0, 5)) {
                const positions: any[] = await fetchData(
                    `https://data-api.polymarket.com/positions?user=${recipient}`
                );
                if (positions && positions.length > 0) {
                    console.log(`   🎯 Address with positions: ${recipient}`);
                    console.log(`   Positions: ${positions.length}\n`);
                }
            }
        }
    } catch (error) {
        console.log('   ⚠️  Failed to check USDC transfers\n');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('💡 MANUAL METHOD (100% works):\n');
    console.log('1. Open polymarket.com\n');
    console.log('2. Connect wallet and copy the address shown\n');
    console.log('3. Update PROXY_WALLET in .env\n');
}

findRealProxyWallet().catch(console.error);
