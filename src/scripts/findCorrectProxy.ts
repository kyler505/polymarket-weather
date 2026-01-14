import { ethers } from 'ethers';
import { ENV } from '../config/env';
import createClobClient from '../utils/createClobClient';

// Registry contract address on Polygon
const CTF_EXCHANGE_ADDRESS = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
const GNOSIS_SAFE_PROXY_FACTORY = '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2';

async function findProxy() {
    console.log(`\n🔍 Finding real Proxy Wallet for EOA: ${ENV.USER_ADDRESSES[0]}\n`);

    try {
        // We can query the CLOB client to derive the API key which often works with the proxy
        // But better is to just ask the factory or compute it.
        // Actually, the easiest way is to use the ClobClient to get it if properly initialized
        // But createClobClient currently relies on ENV.

        // Use a known method to compute/find the address
        // For now, let's use the ClobClient's internal logic if possible,
        // OR we can suggest the user check their Profile URL on Polymarket which usually has the proxy address
        // if they are logged in.

        // Better yet, let's look at the "computeGnosisSafeAddress.ts" logic I deleted.
        // It used the createProxyWithNonce logic.

        // Let's try to query the Polymarket API which usually returns the proxy wallet for a profile
        const response = await fetch(`https://data-api.polymarket.com/users/${ENV.USER_ADDRESSES[0]}`);
        // Wait, data-api doesn't usually give this easily for an address unless we query specific endpoints.

        console.log("Checking Polymarket API...");
        // This is a known endpoint that might return user profile info including proxy
        const profileResp = await fetch(`https://data-api.polymarket.com/profiles?address=${ENV.USER_ADDRESSES[0]}`);

        // Let's try to guess/compute it
        console.log("Note: To find your exact Proxy Wallet address, the most reliable way is:");
        console.log("1. Go to https://polymarket.com");
        console.log("2. Log in with your wallet");
        console.log("3. Go to 'Deposit' page");
        console.log("4. The address shown as 'Your Polymarket Wallet' or similar is your Proxy.");

    } catch (error) {
        console.error("Error:", error);
    }
}

findProxy();
