import { ethers } from 'ethers';
import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';
import getMyBalance from '../utils/getMyBalance';

const PRIVATE_KEY = ENV.PRIVATE_KEY;
const RPC_URL = ENV.RPC_URL;
const USDC_CONTRACT_ADDRESS = ENV.USDC_CONTRACT_ADDRESS;
const PROXY_WALLET = ENV.PROXY_WALLET;
const TARGET_WALLET = ENV.TARGET_WALLET;

interface Position {
    asset: string;
    conditionId: string;
    size: number;
    currentValue: number;
    title?: string;
    slug?: string;
}

const USDC_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)',
];

async function migrateWallet() {
    console.log('\n🔄 WALLET MIGRATION ASSISTANT\n');
    console.log(`   Current wallet:  ${PROXY_WALLET}`);
    console.log(`   Target wallet:   ${TARGET_WALLET || '(not configured)'}\n`);

    // Validate target wallet
    if (!TARGET_WALLET) {
        console.log('❌ ERROR: TARGET_WALLET not configured in .env\n');
        console.log('   Add this to your .env file:');
        console.log("   TARGET_WALLET = '0xYourNewWalletAddress'\n");
        process.exit(1);
    }

    // Check for open positions
    console.log('📊 Checking for open positions...\n');
    const positions: Position[] = await fetchData(
        `https://data-api.polymarket.com/positions?user=${PROXY_WALLET}`
    );

    if (positions && positions.length > 0) {
        const totalValue = positions.reduce((sum, p) => sum + (p.currentValue || 0), 0);
        console.log(`❌ Cannot migrate: You still have ${positions.length} open position(s)\n`);
        console.log(`   Total value: $${totalValue.toFixed(2)}\n`);
        console.log('   Open positions:');
        for (const pos of positions) {
            console.log(`   • ${pos.title || pos.slug || 'Unknown market'}: ${pos.size.toFixed(2)} shares ($${(pos.currentValue || 0).toFixed(2)})`);
        }
        console.log('\n💡 To migrate:');
        console.log('   1. Enable WIND_DOWN_MODE=true in .env');
        console.log('   2. Wait for copied traders to sell (or manually sell via Polymarket UI)');
        console.log('   3. Run this script again when all positions are closed\n');
        process.exit(1);
    }

    console.log('✅ No open positions found\n');

    // Check USDC balance
    const balance = await getMyBalance(PROXY_WALLET);
    console.log(`💰 USDC Balance: $${balance.toFixed(2)}\n`);

    if (balance < 0.01) {
        console.log('⚠️  Balance too low to migrate (need at least $0.01)\n');
        process.exit(0);
    }

    // Confirmation prompt
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚠️  CONFIRM MIGRATION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`   Amount:      $${balance.toFixed(2)} USDC`);
    console.log(`   From:        ${PROXY_WALLET}`);
    console.log(`   To:          ${TARGET_WALLET}\n`);
    console.log('   This action is IRREVERSIBLE.\n');

    // Wait for user confirmation via stdin
    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const confirmed = await new Promise<boolean>((resolve) => {
        rl.question('   Type "MIGRATE" to confirm: ', (answer: string) => {
            rl.close();
            resolve(answer.trim().toUpperCase() === 'MIGRATE');
        });
    });

    if (!confirmed) {
        console.log('\n❌ Migration cancelled\n');
        process.exit(0);
    }

    // Perform transfer
    console.log('\n📤 Initiating transfer...\n');

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, wallet);

    try {
        const decimals = await usdcContract.decimals();
        const rawBalance: bigint = await usdcContract.balanceOf(PROXY_WALLET);

        // Leave a tiny dust amount for potential gas estimation needs
        const transferAmount = rawBalance - BigInt(1); // Leave 0.000001 USDC

        if (transferAmount <= 0n) {
            console.log('❌ Insufficient balance after accounting for dust\n');
            process.exit(1);
        }

        const transferFormatted = ethers.formatUnits(transferAmount, decimals);
        console.log(`   Transferring: ${transferFormatted} USDC\n`);

        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice
            ? (feeData.gasPrice * 150n) / 100n
            : ethers.parseUnits('50', 'gwei');

        console.log(`   Gas price: ${ethers.formatUnits(gasPrice, 'gwei')} Gwei\n`);

        const tx = await usdcContract.transfer(TARGET_WALLET, transferAmount, {
            gasPrice: gasPrice,
            gasLimit: 100000,
        });

        console.log(`   ⏳ Transaction sent: ${tx.hash}`);
        console.log('   Waiting for confirmation...\n');

        const receipt = await tx.wait();

        if (receipt.status === 1) {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('✅ MIGRATION SUCCESSFUL');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            console.log(`   Amount:       ${transferFormatted} USDC`);
            console.log(`   To:           ${TARGET_WALLET}`);
            console.log(`   TX:           https://polygonscan.com/tx/${tx.hash}\n`);
            console.log('📝 Next steps:');
            console.log('   1. Update PROXY_WALLET in .env to the new address');
            console.log('   2. Set WIND_DOWN_MODE=false');
            console.log('   3. Restart the bot\n');
        } else {
            console.log('❌ Transaction failed!\n');
            process.exit(1);
        }
    } catch (error: any) {
        console.error(`❌ Transfer error: ${error.message}\n`);
        if (error.code === 'INSUFFICIENT_FUNDS') {
            console.log('   You need MATIC for gas fees on Polygon\n');
        }
        process.exit(1);
    }
}

migrateWallet()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    });
