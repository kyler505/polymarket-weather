import * as dotenv from 'dotenv';
dotenv.config();

/**
 * Validate Ethereum address format
 */
const isValidEthereumAddress = (address: string): boolean => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
};

/**
 * Validate required environment variables
 */
const validateRequiredEnv = (): void => {
    const required = [
        'PROXY_WALLET',
        'PRIVATE_KEY',
        'CLOB_HTTP_URL',
        'CLOB_WS_URL',
        'MONGO_URI',
        'RPC_URL',
        'USDC_CONTRACT_ADDRESS',
    ];

    const missing: string[] = [];
    for (const key of required) {
        if (!process.env[key]) {
            missing.push(key);
        }
    }

    if (missing.length > 0) {
        console.error('\n❌ Configuration Error: Missing required environment variables\n');
        console.error(`Missing variables: ${missing.join(', ')}\n`);
        console.error('🔧 Quick fix:');
        console.error('   1. Run the setup wizard: npm run setup');
        console.error('   2. Or manually create .env file with all required variables\n');
        throw new Error(
            `Missing required environment variables: ${missing.join(', ')}`
        );
    }
};

/**
 * Validate Ethereum addresses
 */
const validateAddresses = (): void => {
    if (process.env.PROXY_WALLET && !isValidEthereumAddress(process.env.PROXY_WALLET)) {
        console.error('\n❌ Invalid Wallet Address\n');
        console.error(`Your PROXY_WALLET: ${process.env.PROXY_WALLET}`);
        console.error('Expected format:    0x followed by 40 hexadecimal characters\n');
        throw new Error(
            `Invalid PROXY_WALLET address format: ${process.env.PROXY_WALLET}`
        );
    }

    if (
        process.env.USDC_CONTRACT_ADDRESS &&
        !isValidEthereumAddress(process.env.USDC_CONTRACT_ADDRESS)
    ) {
        console.error('\n❌ Invalid USDC Contract Address\n');
        console.error(`Current value: ${process.env.USDC_CONTRACT_ADDRESS}`);
        throw new Error(
            `Invalid USDC_CONTRACT_ADDRESS format: ${process.env.USDC_CONTRACT_ADDRESS}`
        );
    }
};

/**
 * Validate URL formats
 */
const validateUrls = (): void => {
    if (process.env.CLOB_HTTP_URL && !process.env.CLOB_HTTP_URL.startsWith('http')) {
        throw new Error(
            `Invalid CLOB_HTTP_URL: ${process.env.CLOB_HTTP_URL}. Must be a valid HTTP/HTTPS URL.`
        );
    }

    if (process.env.CLOB_WS_URL && !process.env.CLOB_WS_URL.startsWith('ws')) {
        throw new Error(
            `Invalid CLOB_WS_URL: ${process.env.CLOB_WS_URL}. Must be a valid WebSocket URL (ws:// or wss://).`
        );
    }

    if (process.env.RPC_URL && !process.env.RPC_URL.startsWith('http')) {
        throw new Error(`Invalid RPC_URL: ${process.env.RPC_URL}. Must be a valid HTTP/HTTPS URL.`);
    }

    if (process.env.MONGO_URI && !process.env.MONGO_URI.startsWith('mongodb')) {
        throw new Error(
            `Invalid MONGO_URI: ${process.env.MONGO_URI}. Must be a valid MongoDB connection string.`
        );
    }
};

// Run all validations
validateRequiredEnv();
validateAddresses();
validateUrls();

export const ENV = {
    // === Core Wallet/Network Settings ===
    PROXY_WALLET: process.env.PROXY_WALLET as string,
    PRIVATE_KEY: process.env.PRIVATE_KEY as string,
    CLOB_HTTP_URL: process.env.CLOB_HTTP_URL as string,
    CLOB_WS_URL: process.env.CLOB_WS_URL as string,
    MONGO_URI: process.env.MONGO_URI as string,
    RPC_URL: process.env.RPC_URL as string,
    USDC_CONTRACT_ADDRESS: process.env.USDC_CONTRACT_ADDRESS as string,

    // === Weather Trading Settings ===
    // Edge threshold - minimum edge required to trade
    WEATHER_EDGE_THRESHOLD: parseFloat(process.env.WEATHER_EDGE_THRESHOLD || '0.03'),
    // Maximum lead days to trade (only trade markets resolving within N days)
    WEATHER_MAX_LEAD_DAYS: parseInt(process.env.WEATHER_MAX_LEAD_DAYS || '7', 10),
    // Observation polling interval on day-of (ms)
    WEATHER_OBSERVATION_POLL_MS: parseInt(process.env.WEATHER_OBSERVATION_POLL_MS || '300000', 10), // 5 min
    // Market discovery interval (ms)
    WEATHER_DISCOVERY_INTERVAL_MS: parseInt(process.env.WEATHER_DISCOVERY_INTERVAL_MS || '3600000', 10), // 1 hour
    // Forecast refresh interval (ms)
    WEATHER_FORECAST_REFRESH_MS: parseInt(process.env.WEATHER_FORECAST_REFRESH_MS || '1800000', 10), // 30 min
    // Dry run mode - compute probabilities but don't execute trades

    // Minimum parser confidence to trade a market (0-1)
    WEATHER_MIN_PARSER_CONFIDENCE: parseFloat(process.env.WEATHER_MIN_PARSER_CONFIDENCE || '0.8'),

    // === Hybrid ML Forecast Settings ===
    WEATHER_ML_ENABLED: process.env.WEATHER_ML_ENABLED === 'true',
    WEATHER_ML_LOOKBACK_DAYS: parseInt(process.env.WEATHER_ML_LOOKBACK_DAYS || '60', 10),
    WEATHER_ML_MIN_SAMPLES: parseInt(process.env.WEATHER_ML_MIN_SAMPLES || '25', 10),
    WEATHER_ML_ALLOW_SIMULATED_TRAINING: process.env.WEATHER_ML_ALLOW_SIMULATED_TRAINING === 'true',
    WEATHER_ML_PYTHON_PATH: process.env.WEATHER_ML_PYTHON_PATH || 'python3',
    WEATHER_ML_TIMEOUT_MS: parseInt(process.env.WEATHER_ML_TIMEOUT_MS || '15000', 10),
    WEATHER_ML_CACHE_TTL_MS: parseInt(process.env.WEATHER_ML_CACHE_TTL_MS || '900000', 10), // 15 min
    WEATHER_ML_TRAINING_CACHE_TTL_MS: parseInt(process.env.WEATHER_ML_TRAINING_CACHE_TTL_MS || '21600000', 10), // 6 hours
    WEATHER_ML_RIDGE_ALPHA: parseFloat(process.env.WEATHER_ML_RIDGE_ALPHA || '1.0'),
    WEATHER_ML_KNN_K: parseInt(process.env.WEATHER_ML_KNN_K || '7', 10),
    WEATHER_ML_CALIBRATION_SPLIT: parseFloat(process.env.WEATHER_ML_CALIBRATION_SPLIT || '0.2'),
    WEATHER_ML_CLIP_DELTA: parseFloat(process.env.WEATHER_ML_CLIP_DELTA || '12'),
    WEATHER_ML_SIGMA_FLOOR: parseFloat(process.env.WEATHER_ML_SIGMA_FLOOR || '1.5'),
    WEATHER_ML_SEED: parseInt(process.env.WEATHER_ML_SEED || '42', 10),

    // === Risk Management Settings ===
    // Maximum exposure per market (USD)
    MAX_EXPOSURE_PER_MARKET_USD: parseFloat(process.env.MAX_EXPOSURE_PER_MARKET_USD || '50'),
    // Maximum exposure per region/city (USD)
    MAX_EXPOSURE_PER_REGION_USD: parseFloat(process.env.MAX_EXPOSURE_PER_REGION_USD || '200'),
    // Maximum exposure for markets resolving on same date (USD)
    MAX_EXPOSURE_PER_DATE_USD: parseFloat(process.env.MAX_EXPOSURE_PER_DATE_USD || '300'),
    // Maximum daily loss before bot pauses (USD)
    MAX_DAILY_LOSS_USD: parseFloat(process.env.MAX_DAILY_LOSS_USD || '100'),
    // Maximum data age before kill-switch (ms)
    MAX_DATA_AGE_MS: parseInt(process.env.MAX_DATA_AGE_MS || '3600000', 10), // 1 hour

    // === Order Sizing Settings ===
    // Minimum order size (USD)
    MIN_ORDER_SIZE_USD: parseFloat(process.env.MIN_ORDER_SIZE_USD || '1.0'),
    // Maximum order size (USD)
    MAX_ORDER_SIZE_USD: parseFloat(process.env.MAX_ORDER_SIZE_USD || '25'),

    // === Network/Rate Limit Settings ===
    REQUEST_TIMEOUT_MS: parseInt(process.env.REQUEST_TIMEOUT_MS || '10000', 10),
    NETWORK_RETRY_LIMIT: parseInt(process.env.NETWORK_RETRY_LIMIT || '3', 10),
    RETRY_DELAY_BASE_MS: parseInt(process.env.RETRY_DELAY_BASE_MS || '2000', 10),
    RETRY_DELAY_MAX_MS: parseInt(process.env.RETRY_DELAY_MAX_MS || '30000', 10),
    RATE_LIMIT_COOLDOWN_MS: parseInt(process.env.RATE_LIMIT_COOLDOWN_MS || '60000', 10),
    WEATHER_DRY_RUN: process.env.WEATHER_DRY_RUN === 'true',
    EXECUTOR_POLL_INTERVAL_MS: parseInt(process.env.EXECUTOR_POLL_INTERVAL_MS || '5000', 10),
    MONITOR_POLL_JITTER_MS: parseInt(process.env.MONITOR_POLL_JITTER_MS || '500', 10),

    // === Slippage Settings ===
    MAX_SLIPPAGE_PERCENT: parseFloat(process.env.MAX_SLIPPAGE_PERCENT || '5'),

    // === Position Management Settings ===
    STOP_LOSS_ENABLED: process.env.STOP_LOSS_ENABLED === 'true',
    STOP_LOSS_PERCENT: parseFloat(process.env.STOP_LOSS_PERCENT || '20'),
    TAKE_PROFIT_ENABLED: process.env.TAKE_PROFIT_ENABLED === 'true',
    TAKE_PROFIT_PERCENT: parseFloat(process.env.TAKE_PROFIT_PERCENT || '50'),
    TRAILING_STOP_ENABLED: process.env.TRAILING_STOP_ENABLED === 'true',
    TRAILING_STOP_PERCENT: parseFloat(process.env.TRAILING_STOP_PERCENT || '15'),
    POSITION_CHECK_INTERVAL_MS: parseInt(process.env.POSITION_CHECK_INTERVAL_MS || '60000', 10),
    SL_TP_MIN_PRICE_PERCENT: parseFloat(process.env.SL_TP_MIN_PRICE_PERCENT || '50'),

    // === Discord Notifications ===
    DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL || '',
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || '',
    DISCORD_CHANNEL_ID: process.env.DISCORD_CHANNEL_ID || '',
};
