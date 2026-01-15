/**
 * Discord Notification Service
 * Sends notifications to Discord webhook for important bot events
 */

import { ENV } from '../config/env';
import Logger from '../utils/logger';

// ============================================================================
// CONFIGURATION
// ============================================================================

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const NOTIFICATIONS_ENABLED = process.env.DISCORD_NOTIFICATIONS_ENABLED === 'true';
const BOT_NAME = process.env.DISCORD_BOT_NAME || '🌤️ Weather Trading Bot';

// Notification types that can be enabled/disabled
const NOTIFY_TRADES = process.env.DISCORD_NOTIFY_TRADES !== 'false'; // default: true
const NOTIFY_SL_TP = process.env.DISCORD_NOTIFY_SL_TP !== 'false'; // default: true
const NOTIFY_ERRORS = process.env.DISCORD_NOTIFY_ERRORS !== 'false'; // default: true
const NOTIFY_STARTUP = process.env.DISCORD_NOTIFY_STARTUP !== 'false'; // default: true

// Rate limiting for notifications (prevent spam)
let lastNotificationTime = 0;
const MIN_NOTIFICATION_INTERVAL_MS = 1000; // 1 second between notifications

// ============================================================================
// DISCORD EMBED COLORS
// ============================================================================

const COLORS = {
    SUCCESS: 0x00ff00, // Green
    WARNING: 0xffff00, // Yellow
    ERROR: 0xff0000,   // Red
    INFO: 0x0099ff,    // Blue
    BUY: 0x00ff00,     // Green
    SELL: 0xff6600,    // Orange
    STOP_LOSS: 0xff0000, // Red
    TAKE_PROFIT: 0x00ff00, // Green
    TRAILING_STOP: 0xffaa00, // Amber
};

// ============================================================================
// NOTIFICATION FUNCTIONS
// ============================================================================

interface DiscordEmbed {
    title: string;
    description?: string;
    color: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    footer?: { text: string };
    timestamp?: string;
}

/**
 * Send a message to Discord webhook
 */
const sendWebhook = async (embeds: DiscordEmbed[]): Promise<boolean> => {
    if (!NOTIFICATIONS_ENABLED || !WEBHOOK_URL) {
        return false;
    }

    // Rate limiting
    const now = Date.now();
    if (now - lastNotificationTime < MIN_NOTIFICATION_INTERVAL_MS) {
        await new Promise(resolve => setTimeout(resolve, MIN_NOTIFICATION_INTERVAL_MS));
    }
    lastNotificationTime = Date.now();

    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: BOT_NAME,
                embeds: embeds.map(embed => ({
                    ...embed,
                    timestamp: embed.timestamp || new Date().toISOString(),
                })),
            }),
        });

        if (!response.ok) {
            Logger.warning(`Discord webhook failed: ${response.status} ${response.statusText}`);
            return false;
        }

        return true;
    } catch (error) {
        Logger.warning(`Discord notification error: ${error}`);
        return false;
    }
};

// ============================================================================
// PUBLIC NOTIFICATION METHODS
// ============================================================================

/**
 * Notify on trade execution
 */
export const notifyTrade = async (params: {
    side: 'BUY' | 'SELL';
    market: string;
    outcome?: string;
    price: number;
    size: number;
    edge?: number;
    reason?: string;
}): Promise<void> => {
    if (!NOTIFY_TRADES) return;

    const emoji = params.side === 'BUY' ? '🟢' : '🔴';
    const color = params.side === 'BUY' ? COLORS.BUY : COLORS.SELL;

    const fields = [
        { name: 'Market', value: params.market.substring(0, 100), inline: false },
        ...(params.outcome ? [{ name: 'Outcome', value: params.outcome, inline: true }] : []),
        { name: 'Size', value: `$${params.size.toFixed(2)}`, inline: true },
        { name: 'Price', value: `$${params.price.toFixed(3)}`, inline: true },
        ...(params.edge !== undefined ? [{ name: 'Edge', value: `${(params.edge * 100).toFixed(1)}%`, inline: true }] : []),
        ...(params.reason ? [{ name: 'Reason', value: params.reason, inline: false }] : []),
    ];

    await sendWebhook([{
        title: `${emoji} ${params.side} Order Executed`,
        color,
        fields,
    }]);
};

/**
 * Notify on stop-loss trigger
 */
export const notifyStopLoss = async (params: {
    market: string;
    tokens: number;
    price: number;
    pnlPercent: number;
}): Promise<void> => {
    if (!NOTIFY_SL_TP) return;

    await sendWebhook([{
        title: '🛑 Stop-Loss Triggered',
        color: COLORS.STOP_LOSS,
        fields: [
            { name: 'Market', value: params.market, inline: false },
            { name: 'Sold', value: `${params.tokens.toFixed(2)} tokens`, inline: true },
            { name: 'Price', value: `$${params.price.toFixed(3)}`, inline: true },
            { name: 'P&L', value: `${params.pnlPercent.toFixed(1)}%`, inline: true },
        ],
    }]);
};

/**
 * Notify on take-profit trigger
 */
export const notifyTakeProfit = async (params: {
    market: string;
    tokens: number;
    price: number;
    pnlPercent: number;
}): Promise<void> => {
    if (!NOTIFY_SL_TP) return;

    await sendWebhook([{
        title: '💰 Take-Profit Triggered',
        color: COLORS.TAKE_PROFIT,
        fields: [
            { name: 'Market', value: params.market, inline: false },
            { name: 'Sold', value: `${params.tokens.toFixed(2)} tokens`, inline: true },
            { name: 'Price', value: `$${params.price.toFixed(3)}`, inline: true },
            { name: 'P&L', value: `+${params.pnlPercent.toFixed(1)}%`, inline: true },
        ],
    }]);
};

/**
 * Notify on trailing stop trigger
 */
export const notifyTrailingStop = async (params: {
    market: string;
    tokens: number;
    price: number;
    pnlPercent: number;
    peakPnl: number;
}): Promise<void> => {
    if (!NOTIFY_SL_TP) return;

    await sendWebhook([{
        title: '📉 Trailing Stop Triggered',
        color: COLORS.TRAILING_STOP,
        fields: [
            { name: 'Market', value: params.market, inline: false },
            { name: 'Sold', value: `${params.tokens.toFixed(2)} tokens`, inline: true },
            { name: 'Price', value: `$${params.price.toFixed(3)}`, inline: true },
            { name: 'Current P&L', value: `${params.pnlPercent.toFixed(1)}%`, inline: true },
            { name: 'Peak P&L', value: `${params.peakPnl.toFixed(1)}%`, inline: true },
        ],
    }]);
};

/**
 * Notify on error
 */
export const notifyError = async (params: {
    title: string;
    message: string;
}): Promise<void> => {
    if (!NOTIFY_ERRORS) return;

    await sendWebhook([{
        title: `⚠️ ${params.title}`,
        description: params.message,
        color: COLORS.ERROR,
    }]);
};

/**
 * Notify on bot startup
 */
export const notifyStartup = async (params: {
    markets?: number;
    balance: number;
    positions: number;
}): Promise<void> => {
    if (!NOTIFY_STARTUP) return;

    await sendWebhook([{
        title: '🌤️ Weather Trading Bot Started',
        color: COLORS.INFO,
        fields: [
            ...(params.markets !== undefined ? [{ name: 'Markets', value: `${params.markets}`, inline: true }] : []),
            { name: 'Balance', value: `$${params.balance.toFixed(2)}`, inline: true },
            { name: 'Positions', value: `${params.positions}`, inline: true },
        ],
        footer: { text: 'Polymarket Weather Prediction Bot' },
    }]);
};

/**
 * Notify daily summary
 */
export const notifyDailySummary = async (params: {
    trades: number;
    volume: number;
    pnl: number;
    pnlPercent: number;
}): Promise<void> => {
    const pnlEmoji = params.pnl >= 0 ? '📈' : '📉';
    const color = params.pnl >= 0 ? COLORS.SUCCESS : COLORS.ERROR;

    await sendWebhook([{
        title: `${pnlEmoji} Daily Summary`,
        color,
        fields: [
            { name: 'Trades', value: `${params.trades}`, inline: true },
            { name: 'Volume', value: `$${params.volume.toFixed(2)}`, inline: true },
            { name: 'P&L', value: `$${params.pnl.toFixed(2)} (${params.pnlPercent >= 0 ? '+' : ''}${params.pnlPercent.toFixed(1)}%)`, inline: true },
        ],
    }]);
};

/**
 * Check if notifications are properly configured
 */
export const isNotificationsEnabled = (): boolean => {
    return NOTIFICATIONS_ENABLED && !!WEBHOOK_URL;
};

/**
 * Log notification configuration at startup
 */
export const logNotificationConfig = (): void => {
    if (!NOTIFICATIONS_ENABLED) {
        Logger.info('📢 Discord Notifications: DISABLED');
        return;
    }

    if (!WEBHOOK_URL) {
        Logger.warning('📢 Discord Notifications: ENABLED but DISCORD_WEBHOOK_URL not set');
        return;
    }

    Logger.info('📢 Discord Notifications: ENABLED');
    Logger.info(`   Trades: ${NOTIFY_TRADES ? 'ON' : 'OFF'}`);
    Logger.info(`   SL/TP: ${NOTIFY_SL_TP ? 'ON' : 'OFF'}`);
    Logger.info(`   Errors: ${NOTIFY_ERRORS ? 'ON' : 'OFF'}`);
    Logger.info(`   Startup: ${NOTIFY_STARTUP ? 'ON' : 'OFF'}`);
};
