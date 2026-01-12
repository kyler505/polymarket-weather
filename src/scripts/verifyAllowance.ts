import { ethers } from 'ethers';
import { ENV } from '../config/env';

const PROXY_WALLET = ENV.PROXY_WALLET;
const RPC_URL = ENV.RPC_URL;
const USDC_CONTRACT_ADDRESS = ENV.USDC_CONTRACT_ADDRESS;

const POLYMARKET_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';

const USDC_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function decimals() view returns (uint8)',
];

async function verifyAllowance() {
    console.log('🔍 Verifying USDC allowance status...\n');

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, provider);

    try {
        const decimals = await usdcContract.decimals();

        const balance: bigint = await usdcContract.balanceOf(PROXY_WALLET);
        const balanceFormatted = ethers.formatUnits(balance, decimals);

        const currentAllowance: bigint = await usdcContract.allowance(PROXY_WALLET, POLYMARKET_EXCHANGE);
        const allowanceFormatted = ethers.formatUnits(currentAllowance, decimals);

        console.log('═'.repeat(70));
        console.log('📊 WALLET STATUS');
        console.log('═'.repeat(70));
        console.log(`💼 Wallet:     ${PROXY_WALLET}`);
        console.log(`💵 USDC:       ${balanceFormatted} USDC`);
        console.log(
            `✅ Allowance:  ${currentAllowance === 0n ? '0 USDC (NOT SET!)' : allowanceFormatted + ' USDC (SET!)'}`
        );
        console.log(`📍 Exchange:   ${POLYMARKET_EXCHANGE}`);
        console.log('═'.repeat(70));

        if (currentAllowance === 0n) {
            console.log('\n❌ PROBLEM: Allowance is NOT set!');
            console.log('\n📝 TO FIX: Run: npm run check-allowance');
            process.exit(1);
        } else if (currentAllowance < balance) {
            console.log('\n⚠️  WARNING: Allowance is less than your balance!');
            console.log(`   Balance:   ${balanceFormatted} USDC`);
            console.log(`   Allowance: ${allowanceFormatted} USDC`);
            process.exit(1);
        } else {
            console.log('\n✅ SUCCESS: Allowance is properly set!');
            console.log('   You can start trading now.');
            console.log('\n🚀 Start the bot: npm run dev');
            process.exit(0);
        }
    } catch (error: any) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

verifyAllowance();
