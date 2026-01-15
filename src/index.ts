/**
 * Weather Prediction Trading Bot Entry Point
 * Discovers weather markets, computes fair probabilities, and executes trades
 */

import connectDB, { closeDB } from './config/db';
import { ENV } from './config/env';
import createClobClient from './utils/createClobClient';
import Logger from './utils/logger';
import { performHealthCheck, logHealthCheck } from './utils/healthCheck';

import { startWeatherMonitor, stopWeatherMonitor, getMonitorStatus } from './services/weatherMonitor';
import { startWeatherExecutor, stopWeatherExecutor } from './services/weatherExecutor';
import { startRedemptionService, stopRedemptionService } from './services/redemptionService';
import { startPositionManager, stopPositionManager } from './services/positionManager';
import { logNotificationConfig, notifyStartup, isNotificationsEnabled } from './services/discordNotifier';
import { startDiscordBot, stopDiscordBot } from './services/discordBot';
import fetchData from './utils/fetchData';
import getMyBalance from './utils/getMyBalance';

const PROXY_WALLET = ENV.PROXY_WALLET;

// Graceful shutdown handler
let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) {
        Logger.warning('Shutdown already in progress, forcing exit...');
        process.exit(1);
    }

    isShuttingDown = true;
    Logger.separator();
    Logger.info(`Received ${signal}, initiating graceful shutdown...`);

    try {
        // Stop weather services
        stopWeatherMonitor();
        stopWeatherExecutor();
        stopRedemptionService();
        stopPositionManager();
        await stopDiscordBot();

        // Give services time to finish current operations
        Logger.info('Waiting for services to finish current operations...');
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Close database connection
        await closeDB();

        Logger.success('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        Logger.error(`Error during shutdown: ${error}`);
        process.exit(1);
    }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    Logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
    Logger.error(`Uncaught Exception: ${error.message}`);
    gracefulShutdown('uncaughtException').catch(() => {
        process.exit(1);
    });
});

// Handle termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/**
 * Display weather bot startup banner
 */
function displayBanner() {
    console.log('\n');
    console.log('\x1b[36m  ╦ ╦┌─┐┌─┐┌┬┐┬ ┬┌─┐┬─┐  ╔╗ ┌─┐┌┬┐\x1b[0m');
    console.log('\x1b[36m  ║║║├┤ ├─┤ │ ├─┤├┤ ├┬┘  ╠╩╗│ │ │ \x1b[0m');
    console.log('\x1b[36m  ╚╩╝└─┘┴ ┴ ┴ ┴ ┴└─┘┴└─  ╚═╝└─┘ ┴ \x1b[0m');
    console.log('\x1b[33m  Polymarket Weather Prediction Trading\x1b[0m');
    console.log('\x1b[90m  ────────────────────────────────────\x1b[0m\n');
}

export const main = async () => {
    try {
        displayBanner();

        // Quick start tips
        console.log('\x1b[33m💡 Quick Tips:\x1b[0m');
        console.log('   Set \x1b[36mWEATHER_DRY_RUN=true\x1b[0m to test without trading');
        console.log('   Run \x1b[36mnpm run discover\x1b[0m to preview weather markets\n');

        await connectDB();
        Logger.info(`Wallet: ${PROXY_WALLET.slice(0, 8)}...${PROXY_WALLET.slice(-6)}`);

        // Log notification configuration
        logNotificationConfig();

        // Perform initial health check
        Logger.info('Performing initial health check...');
        const healthResult = await performHealthCheck();
        logHealthCheck(healthResult);

        if (!healthResult.healthy) {
            Logger.warning('Health check failed, but continuing startup...');
        }

        Logger.info('Initializing CLOB client...');
        const clobClient = await createClobClient();
        Logger.success('CLOB client ready');

        Logger.separator();

        // Log key configuration
        Logger.info('Weather Bot Configuration:');
        Logger.info(`  Edge threshold: ${(ENV.WEATHER_EDGE_THRESHOLD * 100).toFixed(1)}%`);
        Logger.info(`  Max lead days: ${ENV.WEATHER_MAX_LEAD_DAYS}`);
        Logger.info(`  Max per-market exposure: $${ENV.MAX_EXPOSURE_PER_MARKET_USD}`);
        Logger.info(`  Dry run mode: ${ENV.WEATHER_DRY_RUN ? 'YES' : 'NO'}`);
        Logger.separator();

        // Start weather monitor (discovers markets, computes probabilities)
        Logger.info('Starting Weather Monitor...');
        startWeatherMonitor();

        // Start weather executor (places trades)
        Logger.info('Starting Weather Executor...');
        startWeatherExecutor(clobClient);

        // Start position manager (handles SL/TP)
        startPositionManager();

        // Start redemption service (redeems resolved markets)
        startRedemptionService();

        // Start Discord bot (if enabled)
        await startDiscordBot();

        // Send Discord startup notification
        if (isNotificationsEnabled()) {
            try {
                const balance = await getMyBalance(PROXY_WALLET);
                const positions = await fetchData(`https://data-api.polymarket.com/positions?user=${PROXY_WALLET}`);
                const positionCount = Array.isArray(positions) ? positions.length : 0;

                // Get tracked markets count after a short delay for discovery
                setTimeout(async () => {
                    const status = getMonitorStatus();
                    await notifyStartup({
                        markets: status.trackedMarkets,
                        balance,
                        positions: positionCount,
                    });
                }, 5000);
            } catch (err) {
                Logger.warning(`Failed to send startup notification: ${err}`);
            }
        }

        Logger.success('Weather Trading Bot is running!');
        if (ENV.WEATHER_DRY_RUN) {
            Logger.warning('⚠️  DRY RUN MODE - No real trades will be placed');
        }

    } catch (error) {
        Logger.error(`Fatal error during startup: ${error}`);
        await gracefulShutdown('startup-error');
    }
};

main();
