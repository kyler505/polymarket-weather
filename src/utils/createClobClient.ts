import { ethers } from 'ethers';
import { ClobClient } from '@polymarket/clob-client';
import { SignatureType } from '@polymarket/order-utils';
import { ENV } from '../config/env';
import Logger from './logger';

const PROXY_WALLET = ENV.PROXY_WALLET;
const PRIVATE_KEY = ENV.PRIVATE_KEY;
const CLOB_HTTP_URL = ENV.CLOB_HTTP_URL;
const RPC_URL = ENV.RPC_URL;

/**
 * Determines if a wallet is a Gnosis Safe by checking if it has contract code
 */
const isGnosisSafe = async (address: string): Promise<boolean> => {
    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const code = await provider.getCode(address);
        return code !== '0x';
    } catch (error) {
        Logger.error(`Error checking wallet type: ${error}`);
        return false;
    }
};

const createClobClient = async (): Promise<ClobClient> => {
    const chainId = 137;
    const host = CLOB_HTTP_URL as string;
    const wallet = new ethers.Wallet(PRIVATE_KEY as string);

    // Ethers v6 compatibility shim for @polymarket/clob-client (built for v5)
    // v5 uses _signTypedData, v6 uses signTypedData
    (wallet as any)._signTypedData = wallet.signTypedData.bind(wallet);

    const isProxySafe = await isGnosisSafe(PROXY_WALLET as string);
    const signatureType = isProxySafe ? SignatureType.POLY_GNOSIS_SAFE : SignatureType.EOA;

    Logger.info(
        `Wallet type detected: ${isProxySafe ? 'Gnosis Safe' : 'EOA (Externally Owned Account)'}`
    );

    let clobClient = new ClobClient(
        host,
        chainId,
        wallet as any,
        undefined,
        signatureType,
        isProxySafe ? (PROXY_WALLET as string) : undefined
    );

    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    console.log = function () {};
    console.error = function () {};

    let creds;
    try {
        creds = await clobClient.createApiKey();
        if (!creds.key) {
            creds = await clobClient.deriveApiKey();
        }
    } catch (error: any) {
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
        Logger.error(`Failed to create/derive API key: ${error?.message || error}`);
        throw error;
    }

    clobClient = new ClobClient(
        host,
        chainId,
        wallet as any,
        creds,
        signatureType,
        isProxySafe ? (PROXY_WALLET as string) : undefined
    );

    console.log = originalConsoleLog;
    console.error = originalConsoleError;

    return clobClient;
};

export default createClobClient;
