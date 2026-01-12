import { ethers } from 'ethers';
import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';

const PRIVATE_KEY = ENV.PRIVATE_KEY;
const PROXY_WALLET = ENV.PROXY_WALLET;
const RPC_URL = ENV.RPC_URL;

async function analyzeWallets() {
    console.log('\n🔍 WALLET AND ADDRESS ANALYSIS\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const wallet = new ethers.Wallet(PRIVATE_KEY);
    const eoaAddress = wallet.address;

    console.log('📋 STEP 1: Address from private key (EOA)\n');
    console.log(`   ${eoaAddress}\n`);

    console.log('📋 STEP 2: PROXY_WALLET from .env\n');
    console.log(`   ${PROXY_WALLET}\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🔎 COMPARISON:\n');

    if (eoaAddress.toLowerCase() === PROXY_WALLET.toLowerCase()) {
        console.log('   ⚠️  EOA AND PROXY_WALLET ARE THE SAME ADDRESS!\n');
    } else {
        console.log('   ✅ EOA and PROXY_WALLET are different addresses\n');
        console.log('   EOA (owner):        ', eoaAddress);
        console.log('   PROXY (for trading): ', PROXY_WALLET, '\n');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 STEP 3: Checking PROXY_WALLET type\n');

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const code = await provider.getCode(PROXY_WALLET);
    const isContract = code !== '0x';

    if (isContract) {
        console.log('   ✅ PROXY_WALLET is a smart contract (Gnosis Safe)\n');
    } else {
        console.log('   ⚠️  PROXY_WALLET is NOT a smart contract!\n');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 STEP 4: Activity on Polymarket\n');

    try {
        const proxyPositions: any[] = await fetchData(
            `https://data-api.polymarket.com/positions?user=${PROXY_WALLET}`
        );
        console.log(`   PROXY_WALLET: ${proxyPositions?.length || 0} positions\n`);

        if (eoaAddress.toLowerCase() !== PROXY_WALLET.toLowerCase()) {
            const eoaPositions: any[] = await fetchData(
                `https://data-api.polymarket.com/positions?user=${eoaAddress}`
            );
            console.log(`   EOA: ${eoaPositions?.length || 0} positions\n`);
        }
    } catch (error) {
        console.log('   ⚠️  Failed to get position data\n');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 CONNECTION DATA:\n');
    console.log(`   EOA address:       ${eoaAddress}`);
    console.log(`   Proxy address:     ${PROXY_WALLET}`);
    console.log(`   Proxy type:        ${isContract ? 'Smart Contract' : 'EOA'}\n`);
}

analyzeWallets().catch(console.error);
