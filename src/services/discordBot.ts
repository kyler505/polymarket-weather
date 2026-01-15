/**
 * Discord Bot for Weather Trading Bot
 * Provides slash commands for monitoring and control
 */

import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ButtonInteraction } from 'discord.js';
import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';
import getMyBalance from '../utils/getMyBalance';
import Logger from '../utils/logger';
import { getMonitorStatus } from './weatherMonitor';
import { getExposureSummary, isHealthy, pauseTrading, resumeTrading } from './weatherRiskManager';

// ============================================================================
// CONFIGURATION
// ============================================================================

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';

const BOT_ENABLED = process.env.DISCORD_BOT_ENABLED === 'true';
const POSITIONS_PER_PAGE = 5;

// Bot state
let client: Client | null = null;

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
        .setName('markets')
        .setDescription('Show tracked weather markets'),

    new SlashCommandBuilder()
        .setName('config')
        .setDescription('Display current bot configuration'),

    new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause weather trading'),

    new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume weather trading'),

    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check if bot is running and healthy'),

    new SlashCommandBuilder()
        .setName('exposure')
        .setDescription('Show current exposure and risk limits'),
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
        let unrealizedPnl = 0;

        positionList.forEach((pos: any) => {
            totalValue += pos.currentValue || 0;
            unrealizedPnl += (pos.currentValue || 0) - (pos.initialValue || 0);
        });

        const monitorStatus = getMonitorStatus();
        const exposure = getExposureSummary();

        const embed = new EmbedBuilder()
            .setTitle('🌤️ Weather Bot Statistics')
            .setColor(unrealizedPnl >= 0 ? 0x00ff00 : 0xff0000)
            .addFields(
                { name: '💵 USDC Balance', value: `$${balance.toFixed(2)}`, inline: true },
                { name: '📈 Positions Value', value: `$${totalValue.toFixed(2)}`, inline: true },
                { name: '🎯 Total Portfolio', value: `$${(balance + totalValue).toFixed(2)}`, inline: true },
                { name: '📊 Open Positions', value: `${positionList.length}`, inline: true },
                { name: '💰 Unrealized P&L', value: `$${unrealizedPnl.toFixed(2)}`, inline: true },
                { name: '🌡️ Tracked Markets', value: `${monitorStatus.trackedMarkets}`, inline: true },
                { name: '📋 Pending Signals', value: `${monitorStatus.pendingSignals}`, inline: true },
                { name: '💼 Total Exposure', value: `$${exposure.totalExposure.toFixed(2)}`, inline: true },
                { name: '⏸️ Status', value: exposure.isPaused ? '🔴 Paused' : '🟢 Active', inline: true },
            )
            .setTimestamp()
            .setFooter({ text: `Wallet: ${ENV.PROXY_WALLET.slice(0, 10)}...` });

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await interaction.editReply(`❌ Error fetching stats: ${error}`);
    }
};

const buildPositionsEmbed = (positionList: any[], page: number, totalPages: number): EmbedBuilder => {
    const start = page * POSITIONS_PER_PAGE;
    const end = Math.min(start + POSITIONS_PER_PAGE, positionList.length);
    const pagePositions = positionList.slice(start, end);

    const embed = new EmbedBuilder()
        .setTitle(`📈 Open Positions (${positionList.length})`)
        .setColor(0x0099ff)
        .setTimestamp();

    for (let i = 0; i < pagePositions.length; i++) {
        const pos = pagePositions[i];
        const pnlPercent = pos.percentPnl || 0;
        const emoji = pnlPercent >= 0 ? '🟢' : '🔴';
        const pnlSign = pnlPercent >= 0 ? '+' : '';
        const globalIndex = start + i + 1;

        embed.addFields({
            name: `${emoji} ${globalIndex}. ${(pos.title || 'Unknown').slice(0, 45)}`,
            value: `**${pos.outcome}** | ${pos.size?.toFixed(2)} tokens @ $${pos.avgPrice?.toFixed(3)}\nValue: $${pos.currentValue?.toFixed(2)} | P&L: ${pnlSign}${pnlPercent.toFixed(1)}%`,
            inline: false,
        });
    }

    embed.setFooter({ text: `Page ${page + 1} of ${totalPages} • ${positionList.length} total positions` });
    return embed;
};

const buildPaginationButtons = (currentPage: number, totalPages: number): ActionRowBuilder<ButtonBuilder> => {
    const row = new ActionRowBuilder<ButtonBuilder>();

    row.addComponents(
        new ButtonBuilder()
            .setCustomId('positions_first')
            .setLabel('⏮️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId('positions_prev')
            .setLabel('◀️ Prev')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId('positions_page')
            .setLabel(`${currentPage + 1}/${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('positions_next')
            .setLabel('Next ▶️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage >= totalPages - 1),
        new ButtonBuilder()
            .setCustomId('positions_last')
            .setLabel('⏭️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage >= totalPages - 1),
    );

    return row;
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

        positionList.sort((a: any, b: any) => (b.currentValue || 0) - (a.currentValue || 0));

        const totalPages = Math.ceil(positionList.length / POSITIONS_PER_PAGE);
        let currentPage = 0;

        const embed = buildPositionsEmbed(positionList, currentPage, totalPages);
        const buttons = buildPaginationButtons(currentPage, totalPages);

        const message = await interaction.editReply({
            embeds: [embed],
            components: totalPages > 1 ? [buttons] : [],
        });

        if (totalPages <= 1) return;

        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 120000,
        });

        collector.on('collect', async (buttonInteraction: ButtonInteraction) => {
            if (buttonInteraction.user.id !== interaction.user.id) {
                await buttonInteraction.reply({ content: '❌ Only the command user can navigate', ephemeral: true });
                return;
            }

            switch (buttonInteraction.customId) {
                case 'positions_first':
                    currentPage = 0;
                    break;
                case 'positions_prev':
                    currentPage = Math.max(0, currentPage - 1);
                    break;
                case 'positions_next':
                    currentPage = Math.min(totalPages - 1, currentPage + 1);
                    break;
                case 'positions_last':
                    currentPage = totalPages - 1;
                    break;
            }

            const newEmbed = buildPositionsEmbed(positionList, currentPage, totalPages);
            const newButtons = buildPaginationButtons(currentPage, totalPages);

            await buttonInteraction.update({
                embeds: [newEmbed],
                components: [newButtons],
            });
        });

        collector.on('end', async () => {
            try {
                const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId('expired').setLabel('Session Expired').setStyle(ButtonStyle.Secondary).setDisabled(true)
                );
                await interaction.editReply({ components: [disabledRow] });
            } catch {
                // Message may have been deleted
            }
        });
    } catch (error) {
        await interaction.editReply(`❌ Error fetching positions: ${error}`);
    }
};

const handleMarkets = async (interaction: ChatInputCommandInteraction): Promise<void> => {
    await interaction.deferReply();

    try {
        const monitorStatus = getMonitorStatus();

        const embed = new EmbedBuilder()
            .setTitle('🌡️ Weather Markets')
            .setColor(0x3498db)
            .addFields(
                { name: 'Tracked Markets', value: `${monitorStatus.trackedMarkets}`, inline: true },
                { name: 'Pending Signals', value: `${monitorStatus.pendingSignals}`, inline: true },
                { name: 'Last Discovery', value: monitorStatus.lastDiscovery.toLocaleString(), inline: true },
                { name: 'Monitor Running', value: monitorStatus.isRunning ? '✅' : '❌', inline: true },
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await interaction.editReply(`❌ Error fetching markets: ${error}`);
    }
};

const handleConfig = async (interaction: ChatInputCommandInteraction): Promise<void> => {
    const exposure = getExposureSummary();

    const embed = new EmbedBuilder()
        .setTitle('⚙️ Weather Bot Configuration')
        .setColor(0x3498db)
        .addFields(
            { name: '📊 Edge Threshold', value: `${(ENV.WEATHER_EDGE_THRESHOLD * 100).toFixed(1)}%`, inline: true },
            { name: '📅 Max Lead Days', value: `${ENV.WEATHER_MAX_LEAD_DAYS}`, inline: true },
            { name: '🧪 Dry Run', value: ENV.WEATHER_DRY_RUN ? 'YES' : 'NO', inline: true },
            { name: '💰 Max Per Market', value: `$${ENV.MAX_EXPOSURE_PER_MARKET_USD}`, inline: true },
            { name: '🌍 Max Per Region', value: `$${ENV.MAX_EXPOSURE_PER_REGION_USD}`, inline: true },
            { name: '📅 Max Per Date', value: `$${ENV.MAX_EXPOSURE_PER_DATE_USD}`, inline: true },
            { name: '🛑 Stop-Loss', value: ENV.STOP_LOSS_ENABLED ? `${ENV.STOP_LOSS_PERCENT}%` : 'OFF', inline: true },
            { name: '💰 Take-Profit', value: ENV.TAKE_PROFIT_ENABLED ? `${ENV.TAKE_PROFIT_PERCENT}%` : 'OFF', inline: true },
            { name: '⏸️ Status', value: exposure.isPaused ? 'Paused' : 'Active', inline: true },
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
};

const handleExposure = async (interaction: ChatInputCommandInteraction): Promise<void> => {
    const exposure = getExposureSummary();

    const embed = new EmbedBuilder()
        .setTitle('💼 Current Exposure')
        .setColor(exposure.isPaused ? 0xff0000 : 0x00ff00)
        .addFields(
            { name: 'Total Exposure', value: `$${exposure.totalExposure.toFixed(2)}`, inline: true },
            { name: 'Daily P&L', value: `$${exposure.dailyPnL.toFixed(2)}`, inline: true },
            { name: 'Status', value: exposure.isPaused ? `⏸️ Paused: ${exposure.pauseReason}` : '🟢 Active', inline: true },
        )
        .setTimestamp();

    // Add region breakdown
    const regions = Object.entries(exposure.byRegion);
    if (regions.length > 0) {
        embed.addFields({
            name: '🌍 By Region',
            value: regions.map(([r, v]) => `${r}: $${v.toFixed(0)}`).join('\n') || 'None',
            inline: false,
        });
    }

    // Add date breakdown
    const dates = Object.entries(exposure.byDate);
    if (dates.length > 0) {
        embed.addFields({
            name: '📅 By Date',
            value: dates.map(([d, v]) => `${d}: $${v.toFixed(0)}`).join('\n') || 'None',
            inline: false,
        });
    }

    await interaction.reply({ embeds: [embed] });
};

const handlePause = async (interaction: ChatInputCommandInteraction): Promise<void> => {
    const exposure = getExposureSummary();

    if (exposure.isPaused) {
        await interaction.reply('⚠️ Bot is already paused');
        return;
    }

    pauseTrading('Paused via Discord command');
    Logger.warning('⏸️ Bot paused via Discord command');

    const embed = new EmbedBuilder()
        .setTitle('⏸️ Trading Paused')
        .setDescription('Weather trading has been paused. No new trades will be executed.\nUse `/resume` to continue.')
        .setColor(0xffaa00)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
};

const handleResume = async (interaction: ChatInputCommandInteraction): Promise<void> => {
    const exposure = getExposureSummary();

    if (!exposure.isPaused) {
        await interaction.reply('⚠️ Bot is already running');
        return;
    }

    resumeTrading();
    Logger.success('▶️ Bot resumed via Discord command');

    const embed = new EmbedBuilder()
        .setTitle('▶️ Trading Resumed')
        .setDescription('Weather trading has been resumed. Trades will be executed normally.')
        .setColor(0x00ff00)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
};

const handleStatus = async (interaction: ChatInputCommandInteraction): Promise<void> => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    const health = isHealthy();
    const monitorStatus = getMonitorStatus();
    const exposure = getExposureSummary();

    const embed = new EmbedBuilder()
        .setTitle('🤖 Weather Bot Status')
        .setColor(health.healthy ? 0x00ff00 : 0xff0000)
        .addFields(
            { name: 'Health', value: health.healthy ? '✅ Healthy' : '⚠️ Issues', inline: true },
            { name: 'Trading', value: exposure.isPaused ? '⏸️ Paused' : '🟢 Active', inline: true },
            { name: 'Monitor', value: monitorStatus.isRunning ? '🟢 Running' : '🔴 Stopped', inline: true },
            { name: 'Uptime', value: `${hours}h ${minutes}m`, inline: true },
            { name: 'Markets', value: `${monitorStatus.trackedMarkets}`, inline: true },
            { name: 'Signals', value: `${monitorStatus.pendingSignals}`, inline: true },
        )
        .setTimestamp();

    if (!health.healthy) {
        embed.addFields({
            name: '⚠️ Issues',
            value: health.issues.join('\n'),
            inline: false,
        });
    }

    await interaction.reply({ embeds: [embed] });
};

// ============================================================================
// BOT LIFECYCLE
// ============================================================================

const registerCommands = async (): Promise<void> => {
    if (!BOT_TOKEN || !CLIENT_ID) {
        Logger.warning('Discord bot: Missing BOT_TOKEN or CLIENT_ID');
        return;
    }

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

    try {
        Logger.info('🔄 Registering Discord slash commands...');

        if (GUILD_ID) {
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
                body: commands.map(cmd => cmd.toJSON()),
            });
        } else {
            await rest.put(Routes.applicationCommands(CLIENT_ID), {
                body: commands.map(cmd => cmd.toJSON()),
            });
        }

        Logger.success(`✅ Registered ${commands.length} Discord commands`);
    } catch (error) {
        Logger.error(`Failed to register Discord commands: ${error}`);
    }
};

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
                case 'markets':
                    await handleMarkets(interaction);
                    break;
                case 'config':
                    await handleConfig(interaction);
                    break;
                case 'exposure':
                    await handleExposure(interaction);
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

    await registerCommands();
    await client.login(BOT_TOKEN);
};

export const stopDiscordBot = async (): Promise<void> => {
    if (client) {
        client.destroy();
        client = null;
        Logger.info('🤖 Discord Bot disconnected');
    }
};

export const isBotPaused = (): boolean => {
    const exposure = getExposureSummary();
    return exposure.isPaused;
};
