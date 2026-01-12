import { ethers } from 'ethers';
import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';

const PRIVATE_KEY = ENV.PRIVATE_KEY;
const RPC_URL = ENV.RPC_URL;

const EOA_ADDRESS = '0x4fbBe5599c06e846D2742014c9eB04A8a3d1DE8C';
const GNOSIS_SAFE_ADDRESS = '0xd62531bc536bff72394fc5ef715525575787e809';
const CONDITIONAL_TOKENS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

interface Position {
    asset: string;
    conditionId: string;
    size: number;
    avgPrice: number;
    currentValue: number;
    cashPnl: number;
    percentPnl: number;
    curPrice: number;
    title?: string;
    slug?: string;
    outcome?: string;
}

async function transferPositions() {
    console.log('\n🔄 TRANSFERRING POSITIONS FROM EOA TO GNOSIS SAFE\n');

    console.log(`   FROM (EOA):          ${EOA_ADDRESS}`);
    console.log(`   TO (Gnosis Safe):    ${GNOSIS_SAFE_ADDRESS}\n`);

    const positions: Position[] = await fetchData(
        `https://data-api.polymarket.com/positions?user=${EOA_ADDRESS}`
    );

    if (!positions || positions.length === 0) {
        console.log('❌ No positions on EOA to transfer\n');
        return;
    }

    console.log(`✅ Found positions: ${positions.length}`);
    console.log(`💰 Total value: $${positions.reduce((s, p) => s + p.currentValue, 0).toFixed(2)}\n`);

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log(`✅ Connected to Polygon\n`);

    if (wallet.address.toLowerCase() !== EOA_ADDRESS.toLowerCase()) {
        console.log('❌ ERROR: Private key does not match EOA address!\n');
        return;
    }

    const erc1155Abi = [
        'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
        'function balanceOf(address account, uint256 id) view returns (uint256)',
        'function isApprovedForAll(address account, address operator) view returns (bool)',
        'function setApprovalForAll(address operator, bool approved)',
    ];

    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];

        console.log(`\n📦 Position ${i + 1}/${positions.length}`);
        console.log(`Market: ${pos.title || 'Unknown'}`);
        console.log(`Size: ${pos.size.toFixed(2)} shares, Value: $${pos.currentValue.toFixed(2)}`);

        try {
            const ctfContract = new ethers.Contract(CONDITIONAL_TOKENS, erc1155Abi, wallet);
            const balance: bigint = await ctfContract.balanceOf(EOA_ADDRESS, pos.asset);
            console.log(`\n📊 Balance on EOA: ${ethers.formatUnits(balance, 0)} tokens`);

            if (balance === 0n) {
                console.log('⚠️  Skipping: Balance is zero\n');
                failureCount++;
                continue;
            }

            const gasPrice = await provider.getFeeData();
            const gasPriceWithBuffer = gasPrice.gasPrice ? (gasPrice.gasPrice * 150n) / 100n : ethers.parseUnits('50', 'gwei');

            console.log(`⛽ Gas price: ${ethers.formatUnits(gasPriceWithBuffer, 'gwei')} Gwei\n`);

            const isApproved = await ctfContract.isApprovedForAll(EOA_ADDRESS, GNOSIS_SAFE_ADDRESS);
            if (!isApproved) {
                console.log('🔓 Setting approval for Gnosis Safe...');
                const approveTx = await ctfContract.setApprovalForAll(GNOSIS_SAFE_ADDRESS, true, {
                    gasPrice: gasPriceWithBuffer, gasLimit: 100000,
                });
                await approveTx.wait();
                console.log('✅ Approval set\n');
            }

            console.log(`🔄 Transferring ${ethers.formatUnits(balance, 0)} tokens...`);

            const transferTx = await ctfContract.safeTransferFrom(
                EOA_ADDRESS, GNOSIS_SAFE_ADDRESS, pos.asset, balance, '0x',
                { gasPrice: gasPriceWithBuffer, gasLimit: 200000 }
            );

            console.log(`⏳ TX sent: ${transferTx.hash}`);
            const receipt = await transferTx.wait();
            console.log(`✅ SUCCESS! Block: ${receipt.blockNumber}`);
            successCount++;

            if (i < positions.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }
        } catch (error: any) {
            console.log(`\n❌ ERROR: ${error.message}\n`);
            failureCount++;
        }
    }

    console.log(`\n✅ Successfully transferred: ${successCount}/${positions.length}`);
    console.log(`❌ Errors: ${failureCount}/${positions.length}\n`);
}

transferPositions().catch((error) => { console.error('\n❌ Critical error:', error); process.exit(1); });
