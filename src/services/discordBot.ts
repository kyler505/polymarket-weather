/**
 * Discord Bot Service
 * Interactive slash commands for bot control and analytics
 */

import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';
import getMyBalance from '../utils/getMyBalance';
import Logger from '../utils/logger';

// ============================================================================
// CONFIGURATION
// ============================================================================

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || ''; // Optional: for faster command registration

const BOT_ENABLED = process.env.DISCORD_BOT_ENABLED === 'true';

// Bot state
let client: Client | null = null;
let isPaused = false;

// ============================================================================
// SLASH COMMANDS DEFINITION
// ============================================================================

const commands = [
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Show current balance, positions, and P&L summary'),

    new SlashCommandBuilder()
        .setName('positions')
        .setDescription('List all open positions with details'),

    new SlashCommandBuilder()
        .setName('traders')
        .setDescription('Show trader performance scores'),

    new SlashCommandBuilder()
        .setName('config')
        .setDescription('Display current bot configuration'),

    new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause copy trading (stops new trades)'),

    new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume copy trading'),

    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check if bot is running and healthy'),
];

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

const handleStats = async (interaction: ChatInputCommandInteraction): Promise<void> => {
    await interaction.deferReply();

    try {
        const balance = await getMyBalance(ENV.PROXY_WALLET);
        const positions = await fetchData(`https://data-api.polymarket.com/positions?user=${ENV.PROXY_WALLET}`);
        const positionList = Array.isArray(positions) ? positions : [];

        // Calculate totals
        let totalValue = 0;
        let totalPnl = 0;
        let unrealizedPnl = 0;

        positionList.forEach((pos: any) => {
            totalValue += pos.currentValue || 0;
            totalPnl += pos.cashPnl || 0;
            unrealizedPnl += (pos.currentValue || 0) - (pos.initialValue || 0);
        });

        const embed = new EmbedBuilder()
            .setTitle('📊 Bot Statistics')
            .setColor(totalPnl >= 0 ? 0x00ff00 : 0xff0000)
            .addFields(
                { name: '💵 USDC Balance', value: `$${balance.toFixed(2)}`, inline: true },
                { name: '📈 Positions Value', value: `$${totalValue.toFixed(2)}`, inline: true },
                { name: '🎯 Total Portfolio', value: `$${(balance + totalValue).toFixed(2)}`, inline: true },
                { name: '📊 Open Positions', value: `${positionList.length}`, inline: true },
                { name: '💰 Unrealized P&L', value: `$${unrealizedPnl.toFixed(2)}`, inline: true },
                { name: '⏸️ Status', value: isPaused ? '🔴 Paused' : '🟢 Active', inline: true },
            )
            .setTimestamp()
            .setFooter({ text: `Wallet: ${ENV.PROXY_WALLET.slice(0, 10)}...` });

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await interaction.editReply(`❌ Error fetching stats: ${error}`);
    }
};

const handlePositions = async (interaction: ChatInputCommandInteraction): Promise<void> => {
    await interaction.deferReply();

    try {
        const positions = await fetchData(`https://data-api.polymarket.com/positions?user=${ENV.PROXY_WALLET}`);
        const positionList = Array.isArray(positions) ? positions.filter((p: any) => p.size > 0.001) : [];

        if (positionList.length === 0) {
            await interaction.editReply('📭 No open positions');
            return;
        }

        // Sort by value descending
        positionList.sort((a: any, b: any) => (b.currentValue || 0) - (a.currentValue || 0));

        const embed = new EmbedBuilder()
            .setTitle(`📈 Open Positions (${positionList.length})`)
            .setColor(0x0099ff)
            .setTimestamp();

        // Add top 10 positions
        const topPositions = positionList.slice(0, 10);
        for (const pos of topPositions) {
            const pnlPercent = pos.percentPnl || 0;
            const emoji = pnlPercent >= 0 ? '🟢' : '🔴';
            const pnlSign = pnlPercent >= 0 ? '+' : '';

            embed.addFields({
                name: `${emoji} ${(pos.title || 'Unknown').slice(0, 50)}`,
                value: `**${pos.outcome}** | ${pos.size?.toFixed(2)} tokens @ $${pos.avgPrice?.toFixed(3)}\nValue: $${pos.currentValue?.toFixed(2)} | P&L: ${pnlSign}${pnlPercent.toFixed(1)}%`,
                inline: false,
            });
        }

        if (positionList.length > 10) {
            embed.setFooter({ text: `Showing 10 of ${positionList.length} positions` });
        }

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await interaction.editReply(`❌ Error fetching positions: ${error}`);
    }
};

const handleTraders = async (interaction: ChatInputCommandInteraction): Promise<void> => {
    await interaction.deferReply();

    try {
        const embed = new EmbedBuilder()
            .setTitle('👥 Tracked Traders')
            .setColor(0x9b59b6)
            .setTimestamp();

        for (let i = 0; i < ENV.USER_ADDRESSES.length; i++) {
            const addr = ENV.USER_ADDRESSES[i];
            const multiplier = ENV.TRADER_MULTIPLIERS?.get(addr.toLowerCase()) || ENV.TRADE_MULTIPLIER;

            // Fetch trader's positions for value estimate
            const positions = await fetchData(`https://data-api.polymarket.com/positions?user=${addr}`);
            const positionList = Array.isArray(positions) ? positions : [];
            const totalValue = positionList.reduce((sum: number, p: any) => sum + (p.currentValue || 0), 0);

            embed.addFields({
                name: `${i + 1}. \`${addr.slice(0, 10)}...${addr.slice(-4)}\``,
                value: `Multiplier: **${multiplier}x** | Positions: ${positionList.length} | Value: $${totalValue.toFixed(0)}`,
                inline: false,
            });
        }

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await interaction.editReply(`❌ Error fetching traders: ${error}`);
    }
};

const handleConfig = async (interaction: ChatInputCommandInteraction): Promise<void> => {
    const embed = new EmbedBuilder()
        .setTitle('⚙️ Bot Configuration')
        .setColor(0x3498db)
        .addFields(
            { name: '📋 Strategy', value: `${ENV.COPY_STRATEGY_CONFIG.strategy}`, inline: true },
            { name: '💰 Copy Size', value: `${ENV.COPY_STRATEGY_CONFIG.copySize}`, inline: true },
            { name: '🎚️ Multiplier', value: `${ENV.TRADE_MULTIPLIER}x`, inline: true },
            { name: '🛑 Stop-Loss', value: ENV.STOP_LOSS_ENABLED ? `${ENV.STOP_LOSS_PERCENT}%` : 'OFF', inline: true },
            { name: '💰 Take-Profit', value: ENV.TAKE_PROFIT_ENABLED ? `${ENV.TAKE_PROFIT_PERCENT}%` : 'OFF', inline: true },
            { name: '📉 Trailing Stop', value: ENV.TRAILING_STOP_ENABLED ? `${ENV.TRAILING_STOP_PERCENT}%` : 'OFF', inline: true },
            { name: '📊 Trader Scoring', value: ENV.TRADER_SCORING_ENABLED ? 'ON' : 'OFF', inline: true },
            { name: '👥 Traders', value: `${ENV.USER_ADDRESSES.length}`, inline: true },
            { name: '⏸️ Status', value: isPaused ? 'Paused' : 'Active', inline: true },
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
};

const handlePause = async (interaction: ChatInputCommandInteraction): Promise<void> => {
    if (isPaused) {
        await interaction.reply('⚠️ Bot is already paused');
        return;
    }

    isPaused = true;
    Logger.warning('⏸️ Bot paused via Discord command');

    const embed = new EmbedBuilder()
        .setTitle('⏸️ Bot Paused')
        .setDescription('Copy trading has been paused. No new trades will be executed.\nUse `/resume` to continue.')
        .setColor(0xffaa00)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
};

const handleResume = async (interaction: ChatInputCommandInteraction): Promise<void> => {
    if (!isPaused) {
        await interaction.reply('⚠️ Bot is already running');
        return;
    }

    isPaused = false;
    Logger.success('▶️ Bot resumed via Discord command');

    const embed = new EmbedBuilder()
        .setTitle('▶️ Bot Resumed')
        .setDescription('Copy trading has been resumed. Trades will be executed normally.')
        .setColor(0x00ff00)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
};

const handleStatus = async (interaction: ChatInputCommandInteraction): Promise<void> => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    const embed = new EmbedBuilder()
        .setTitle('🤖 Bot Status')
        .setColor(isPaused ? 0xffaa00 : 0x00ff00)
        .addFields(
            { name: 'Status', value: isPaused ? '⏸️ Paused' : '🟢 Running', inline: true },
            { name: 'Uptime', value: `${hours}h ${minutes}m`, inline: true },
            { name: 'Traders', value: `${ENV.USER_ADDRESSES.length}`, inline: true },
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
};

// ============================================================================
// BOT LIFECYCLE
// ============================================================================

/**
 * Register slash commands with Discord
 */
const registerCommands = async (): Promise<void> => {
    if (!BOT_TOKEN || !CLIENT_ID) {
        Logger.warning('Discord bot: Missing BOT_TOKEN or CLIENT_ID');
        return;
    }

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

    try {
        Logger.info('🔄 Registering Discord slash commands...');

        if (GUILD_ID) {
            // Guild commands (instant, for development)
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
                body: commands.map(cmd => cmd.toJSON()),
            });
        } else {
            // Global commands (takes up to 1 hour to propagate)
            await rest.put(Routes.applicationCommands(CLIENT_ID), {
                body: commands.map(cmd => cmd.toJSON()),
            });
        }

        Logger.success(`✅ Registered ${commands.length} Discord commands`);
    } catch (error) {
        Logger.error(`Failed to register Discord commands: ${error}`);
    }
};

/**
 * Start the Discord bot
 */
export const startDiscordBot = async (): Promise<void> => {
    if (!BOT_ENABLED) {
        Logger.info('🤖 Discord Bot: DISABLED');
        return;
    }

    if (!BOT_TOKEN) {
        Logger.warning('🤖 Discord Bot: ENABLED but DISCORD_BOT_TOKEN not set');
        return;
    }

    client = new Client({
        intents: [GatewayIntentBits.Guilds],
    });

    client.once('ready', () => {
        Logger.success(`🤖 Discord Bot connected as ${client?.user?.tag}`);
    });

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const { commandName } = interaction;

        try {
            switch (commandName) {
                case 'stats':
                    await handleStats(interaction);
                    break;
                case 'positions':
                    await handlePositions(interaction);
                    break;
                case 'traders':
                    await handleTraders(interaction);
                    break;
                case 'config':
                    await handleConfig(interaction);
                    break;
                case 'pause':
                    await handlePause(interaction);
                    break;
                case 'resume':
                    await handleResume(interaction);
                    break;
                case 'status':
                    await handleStatus(interaction);
                    break;
                default:
                    await interaction.reply('Unknown command');
            }
        } catch (error) {
            Logger.error(`Discord command error: ${error}`);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(`❌ Error: ${error}`);
            } else {
                await interaction.reply(`❌ Error: ${error}`);
            }
        }
    });

    // Register commands and login
    await registerCommands();
    await client.login(BOT_TOKEN);
};

/**
 * Stop the Discord bot
 */
export const stopDiscordBot = async (): Promise<void> => {
    if (client) {
        client.destroy();
        client = null;
        Logger.info('🤖 Discord Bot disconnected');
    }
};

/**
 * Check if bot is paused (for use by trade executor)
 */
export const isBotPaused = (): boolean => {
    return isPaused;
};

/**
 * Set pause state programmatically
 */
export const setBotPaused = (paused: boolean): void => {
    isPaused = paused;
};
