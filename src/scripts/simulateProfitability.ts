import axios from 'axios';
import { ENV } from '../config/env';
import getMyBalance from '../utils/getMyBalance';

// Simple console colors without chalk
const colors = {
    cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
    green: (text: string) => `\x1b[32m${text}\x1b[0m`,
    red: (text: string) => `\x1b[31m${text}\x1b[0m`,
    yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
    blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
    gray: (text: string) => `\x1b[90m${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
};

interface Trade {
    id: string;
    timestamp: number;
    market: string;
    asset: string;
    side: 'BUY' | 'SELL';
    price: number;
    usdcSize: number;
    size: number;
    outcome: string;
}

interface Position {
    conditionId: string;
    market: string;
    outcome: string;
    outcomeIndex: number;
    asset: string;
    size: number;
    cost: number;
    avgEntryPrice: number;
    currentValue: number;
    realizedPnl: number;
    unrealizedPnl: number;
}

interface SimulationResult {
    id: string;
    name: string;
    logic: string;
    timestamp: number;
    traderAddress: string;
    startingCapital: number;
    currentCapital: number;
    totalTrades: number;
    copiedTrades: number;
    skippedTrades: number;
    totalInvested: number;
    currentValue: number;
    realizedPnl: number;
    unrealizedPnl: number;
    totalPnl: number;
    roi: number;
    positions: SimulatedPosition[];
    // New realistic simulation fields
    totalFeesPaid: number;
    totalSlippageCost: number;
    equityCurve: EquityPoint[];
    riskMetrics: RiskMetrics;
}

interface SimulatedPosition {
    market: string;
    outcome: string;
    sharesHeld: number; // Track actual shares owned
    entryPrice: number;
    exitPrice: number | null;
    invested: number;
    currentValue: number;
    pnl: number;
    closed: boolean;
    trades: {
        timestamp: number;
        side: 'BUY' | 'SELL';
        price: number;
        size: number;
        usdcSize: number;
        traderPercent: number;
        yourSize: number;
    }[];
}

const DEFAULT_TRADER_ADDRESS = '0x7c3db723f1d4d8cb9c550095203b686cb11e5c6b';
const TRADER_ADDRESS = (process.env.SIM_TRADER_ADDRESS || DEFAULT_TRADER_ADDRESS).toLowerCase();
const STARTING_CAPITAL = 1000; // Simulation with $1000 starting capital
const HISTORY_DAYS = (() => {
    const raw = process.env.SIM_HISTORY_DAYS;
    const value = raw ? Number(raw) : 7;
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 7;
})();
const MULTIPLIER = ENV.TRADE_MULTIPLIER || 1.0;
const COPY_PERCENTAGE = (() => {
    const raw = process.env.COPY_PERCENTAGE;
    const value = raw ? Number(raw) : 10.0;
    return Number.isFinite(value) && value > 0 ? value : 10.0;
})(); // % of trader's order size to copy (default: 10%)
const MIN_ORDER_SIZE = (() => {
    const raw = process.env.SIM_MIN_ORDER_USD;
    const value = raw ? Number(raw) : 1.0;
    return Number.isFinite(value) && value > 0 ? value : 1.0;
})();
const MAX_TRADES_LIMIT = (() => {
    const raw = process.env.SIM_MAX_TRADES;
    const value = raw ? Number(raw) : 5000;
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 5000;
})(); // Limit on number of trades for quick testing

// ============================================================================
// REALISTIC SIMULATION CONFIG
// ============================================================================

interface SimulationConfig {
    slippageEnabled: boolean;
    slippageBasePct: number;      // Base slippage percentage (e.g., 0.1 = 0.1%)
    slippageSizeFactor: number;   // Additional slippage per log10 of order size
    feePct: number;               // Trading fee percentage (e.g., 0.1 = 0.1%)
    gasPerTrade: number;          // Estimated gas cost per trade in USD
}

interface RiskMetrics {
    sharpeRatio: number;
    maxDrawdown: number;
    maxDrawdownPct: number;
    winRate: number;
    lossRate: number;
    profitFactor: number;
    avgWin: number;
    avgLoss: number;
    totalWins: number;
    totalLosses: number;
    longestWinStreak: number;
    longestLossStreak: number;
}

interface EquityPoint {
    timestamp: number;
    date: string;
    equity: number;
    drawdown: number;
    drawdownPct: number;
}

const SIM_CONFIG: SimulationConfig = {
    slippageEnabled: process.env.SIM_SLIPPAGE_ENABLED !== 'false', // Default: true
    slippageBasePct: Number(process.env.SIM_SLIPPAGE_BASE_PCT) || 0.15, // 0.15%
    slippageSizeFactor: Number(process.env.SIM_SLIPPAGE_SIZE_FACTOR) || 0.1, // +0.1% per 10x size
    feePct: Number(process.env.SIM_FEE_PCT) || 0.1, // 0.1% fee
    gasPerTrade: Number(process.env.SIM_GAS_PER_TRADE) || 0.005, // $0.005 gas (Polygon)
};

/**
 * Calculate slippage based on order size
 * Larger orders have more market impact
 */
function calculateSlippage(orderSize: number, side: 'BUY' | 'SELL'): number {
    if (!SIM_CONFIG.slippageEnabled) return 0;

    // Base slippage + size-dependent component
    // log10(10) = 1, log10(100) = 2, log10(1000) = 3
    const sizeMultiplier = Math.max(0, Math.log10(orderSize + 1));
    const slippagePct = SIM_CONFIG.slippageBasePct + (sizeMultiplier * SIM_CONFIG.slippageSizeFactor);

    return slippagePct / 100; // Convert to decimal
}

/**
 * Apply slippage to price
 * BUY: you pay more, SELL: you receive less
 */
function applySlippage(price: number, orderSize: number, side: 'BUY' | 'SELL'): number {
    const slippage = calculateSlippage(orderSize, side);
    if (side === 'BUY') {
        return price * (1 + slippage); // Pay more
    } else {
        return price * (1 - slippage); // Receive less
    }
}

/**
 * Calculate trading fees
 */
function calculateFees(orderSize: number): number {
    const tradingFee = orderSize * (SIM_CONFIG.feePct / 100);
    const gasFee = SIM_CONFIG.gasPerTrade;
    return tradingFee + gasFee;
}

/**
 * Calculate risk metrics from equity curve and closed positions
 */
function calculateRiskMetrics(
    equityCurve: EquityPoint[],
    closedPositions: SimulatedPosition[],
    startingCapital: number
): RiskMetrics {
    // Calculate returns for Sharpe ratio
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
        const dailyReturn = (equityCurve[i].equity - equityCurve[i - 1].equity) / equityCurve[i - 1].equity;
        returns.push(dailyReturn);
    }

    // Sharpe Ratio (annualized, assuming 365 trading days)
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 1
        ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
        : 0;
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365) : 0;

    // Max Drawdown
    let peak = startingCapital;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;
    for (const point of equityCurve) {
        if (point.equity > peak) peak = point.equity;
        const drawdown = peak - point.equity;
        const drawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
        if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
            maxDrawdownPct = drawdownPct;
        }
    }

    // Win/Loss analysis from closed positions
    const wins = closedPositions.filter(p => p.pnl > 0);
    const losses = closedPositions.filter(p => p.pnl < 0);

    const totalWins = wins.length;
    const totalLosses = losses.length;
    const totalClosed = closedPositions.length;

    const winRate = totalClosed > 0 ? (totalWins / totalClosed) * 100 : 0;
    const lossRate = totalClosed > 0 ? (totalLosses / totalClosed) * 100 : 0;

    const grossProfit = wins.reduce((sum, p) => sum + p.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, p) => sum + p.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    const avgWin = totalWins > 0 ? grossProfit / totalWins : 0;
    const avgLoss = totalLosses > 0 ? grossLoss / totalLosses : 0;

    // Calculate streaks
    let currentWinStreak = 0, currentLossStreak = 0;
    let longestWinStreak = 0, longestLossStreak = 0;

    for (const pos of closedPositions) {
        if (pos.pnl > 0) {
            currentWinStreak++;
            currentLossStreak = 0;
            longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
        } else if (pos.pnl < 0) {
            currentLossStreak++;
            currentWinStreak = 0;
            longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
        }
    }

    return {
        sharpeRatio,
        maxDrawdown,
        maxDrawdownPct,
        winRate,
        lossRate,
        profitFactor,
        avgWin,
        avgLoss,
        totalWins,
        totalLosses,
        longestWinStreak,
        longestLossStreak,
    };
}

async function fetchBatch(offset: number, limit: number, sinceTimestamp: number): Promise<Trade[]> {
    const response = await axios.get(
        `https://data-api.polymarket.com/activity?user=${TRADER_ADDRESS}&type=TRADE&limit=${limit}&offset=${offset}`,
        {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        }
    );

    const trades: Trade[] = response.data.map((item: any) => ({
        id: item.id,
        timestamp: item.timestamp,
        market: item.slug || item.market,
        asset: item.asset,
        side: item.side,
        price: item.price,
        usdcSize: item.usdcSize,
        size: item.size,
        outcome: item.outcome || 'Unknown',
    }));

    return trades.filter((t) => t.timestamp >= sinceTimestamp);
}

async function fetchTraderActivity(): Promise<Trade[]> {
    try {
        const fs = await import('fs');
        const path = await import('path');

        // Check cache first
        const cacheDir = path.join(process.cwd(), 'trader_data_cache');
        const today = new Date().toISOString().split('T')[0];
        const cacheFile = path.join(cacheDir, `${TRADER_ADDRESS}_${HISTORY_DAYS}d_${today}.json`);

        if (fs.existsSync(cacheFile)) {
            console.log(colors.cyan('📦 Loading cached trader activity...'));
            const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            console.log(
                colors.green(`✓ Loaded ${cached.trades.length} trades from cache (${cached.name})`)
            );
            return cached.trades;
        }

        console.log(
            colors.cyan(
                `📊 Fetching trader activity from last ${HISTORY_DAYS} days (with parallel requests)...`
            )
        );

        // Calculate timestamp for history window
        const sinceTimestamp = Math.floor((Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000) / 1000);

        // First, get a sample to estimate total
        const firstBatch = await fetchBatch(0, 100, sinceTimestamp);
        let allTrades: Trade[] = [...firstBatch];

        if (firstBatch.length === 100) {
            // Need to fetch more - do it in parallel batches
            const batchSize = 100;
            const maxParallel = 5; // 5 parallel requests at a time
            let offset = 100;
            let hasMore = true;

            while (hasMore && allTrades.length < MAX_TRADES_LIMIT) {
                // Create batch of parallel requests
                const promises: Promise<Trade[]>[] = [];
                for (let i = 0; i < maxParallel; i++) {
                    promises.push(fetchBatch(offset + i * batchSize, batchSize, sinceTimestamp));
                }

                const results = await Promise.all(promises);
                let addedCount = 0;

                for (const batch of results) {
                    if (batch.length > 0) {
                        allTrades = allTrades.concat(batch);
                        addedCount += batch.length;
                    }
                    if (batch.length < batchSize) {
                        hasMore = false;
                        break;
                    }
                }

                if (addedCount === 0) {
                    hasMore = false;
                }

                // Check limit
                if (allTrades.length >= MAX_TRADES_LIMIT) {
                    console.log(
                        colors.yellow(
                            `⚠️  Reached trade limit (${MAX_TRADES_LIMIT}), stopping fetch...`
                        )
                    );
                    allTrades = allTrades.slice(0, MAX_TRADES_LIMIT);
                    hasMore = false;
                }

                offset += maxParallel * batchSize;
                console.log(colors.gray(`  Fetched ${allTrades.length} trades so far...`));
            }
        }

        const sortedTrades = allTrades.sort((a, b) => a.timestamp - b.timestamp);
        console.log(colors.green(`✓ Fetched ${sortedTrades.length} trades from last 7 days`));

        // Save to cache
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        const cacheData = {
            name: `trader_${TRADER_ADDRESS.slice(0, 6)}_${HISTORY_DAYS}d_${today}`,
            traderAddress: TRADER_ADDRESS,
            fetchedAt: new Date().toISOString(),
            period: `${HISTORY_DAYS}_days`,
            totalTrades: sortedTrades.length,
            trades: sortedTrades,
        };

        fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2), 'utf8');
        console.log(colors.green(`✓ Cached trades to: ${cacheFile}\n`));

        return sortedTrades;
    } catch (error) {
        console.error(colors.red('Error fetching trader activity:'), error);
        throw error;
    }
}

async function fetchTraderPositions(): Promise<Position[]> {
    try {
        console.log(colors.cyan('📈 Fetching trader positions...'));
        const response = await axios.get(
            `https://data-api.polymarket.com/positions?user=${TRADER_ADDRESS}`,
            {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
            }
        );

        console.log(colors.green(`✓ Fetched ${response.data.length} positions`));
        return response.data;
    } catch (error) {
        console.error(colors.red('Error fetching positions:'), error);
        throw error;
    }
}

async function simulateCopyTrading(trades: Trade[]): Promise<SimulationResult> {
    console.log(colors.cyan('\n🎮 Starting simulation...\n'));

    if (SIM_CONFIG.slippageEnabled) {
        console.log(colors.yellow(`📉 Slippage enabled: ${SIM_CONFIG.slippageBasePct}% base + ${SIM_CONFIG.slippageSizeFactor}% per 10x size`));
        console.log(colors.yellow(`💸 Fees: ${SIM_CONFIG.feePct}% + $${SIM_CONFIG.gasPerTrade} gas per trade\n`));
    }

    let yourCapital = STARTING_CAPITAL;
    let totalInvested = 0;
    let copiedTrades = 0;
    let skippedTrades = 0;
    let totalFeesPaid = 0;
    let totalSlippageCost = 0;

    // Equity curve tracking
    const equityCurve: EquityPoint[] = [];
    let lastEquityDate = '';

    const positions = new Map<string, SimulatedPosition>();

    for (const trade of trades) {
        // NEW LOGIC: Copy fixed percentage of trader's order size
        const baseOrderSize = trade.usdcSize * (COPY_PERCENTAGE / 100);
        let orderSize = baseOrderSize * MULTIPLIER;

        // Check if order meets minimum
        if (orderSize < MIN_ORDER_SIZE) {
            skippedTrades++;
            continue;
        }

        // Check if we have enough capital
        if (orderSize > yourCapital * 0.95) {
            orderSize = yourCapital * 0.95;
            if (orderSize < MIN_ORDER_SIZE) {
                skippedTrades++;
                continue;
            }
        }

        const positionKey = `${trade.asset}:${trade.outcome}`;

        if (trade.side === 'BUY') {
            // BUY trade with slippage
            const executionPrice = applySlippage(trade.price, orderSize, 'BUY');
            const slippageCost = (executionPrice - trade.price) * (orderSize / executionPrice);
            const fees = calculateFees(orderSize);

            // Check if we can afford order + fees
            if (orderSize + fees > yourCapital * 0.95) {
                orderSize = (yourCapital * 0.95) - fees;
                if (orderSize < MIN_ORDER_SIZE) {
                    skippedTrades++;
                    continue;
                }
            }

            const sharesReceived = orderSize / executionPrice;

            if (!positions.has(positionKey)) {
                positions.set(positionKey, {
                    market: trade.market || trade.asset || 'Unknown market',
                    outcome: trade.outcome,
                    sharesHeld: 0,
                    entryPrice: executionPrice,
                    exitPrice: null,
                    invested: 0,
                    currentValue: 0,
                    pnl: 0,
                    closed: false,
                    trades: [],
                });
            }

            const pos = positions.get(positionKey)!;

            pos.sharesHeld += sharesReceived;
            pos.invested += orderSize;
            pos.currentValue = pos.sharesHeld * trade.price;

            pos.trades.push({
                timestamp: trade.timestamp,
                side: 'BUY',
                price: executionPrice,
                size: sharesReceived,
                usdcSize: orderSize,
                traderPercent: (trade.usdcSize / 100000) * 100,
                yourSize: orderSize,
            });

            yourCapital -= (orderSize + fees);
            totalInvested += orderSize;
            totalFeesPaid += fees;
            totalSlippageCost += slippageCost;
            copiedTrades++;

            // Track equity curve (daily)
            const tradeDate = new Date(trade.timestamp * 1000).toISOString().split('T')[0];
            if (tradeDate !== lastEquityDate) {
                const currentEquity = yourCapital + Array.from(positions.values())
                    .filter(p => !p.closed)
                    .reduce((sum, p) => sum + p.currentValue, 0);
                const peak = equityCurve.length > 0
                    ? Math.max(...equityCurve.map(e => e.equity), currentEquity)
                    : currentEquity;
                equityCurve.push({
                    timestamp: trade.timestamp,
                    date: tradeDate,
                    equity: currentEquity,
                    drawdown: peak - currentEquity,
                    drawdownPct: peak > 0 ? ((peak - currentEquity) / peak) * 100 : 0,
                });
                lastEquityDate = tradeDate;
            }
        } else if (trade.side === 'SELL') {
            // SELL trade
            if (positions.has(positionKey)) {
                const pos = positions.get(positionKey)!;

                if (pos.sharesHeld <= 0) {
                    skippedTrades++;
                    continue;
                }

                // Calculate proportional sell based on trader's order
                const traderSellShares = trade.usdcSize / trade.price;
                const traderTotalShares = traderSellShares / 0.1; // Estimate (we don't know trader's exact position)
                const traderSellPercent = Math.min(traderSellShares / traderTotalShares, 1.0);

                // Sell same proportion of our shares with slippage
                const sharesToSell = Math.min(pos.sharesHeld * traderSellPercent, pos.sharesHeld);
                const executionPrice = applySlippage(trade.price, sharesToSell * trade.price, 'SELL');
                const sellAmount = sharesToSell * executionPrice;
                const slippageCost = (trade.price - executionPrice) * sharesToSell;
                const fees = calculateFees(sellAmount);

                pos.sharesHeld -= sharesToSell;
                pos.currentValue = pos.sharesHeld * trade.price;
                pos.exitPrice = executionPrice;

                pos.trades.push({
                    timestamp: trade.timestamp,
                    side: 'SELL',
                    price: executionPrice,
                    size: sharesToSell,
                    usdcSize: sellAmount,
                    traderPercent: traderSellPercent * 100,
                    yourSize: sellAmount,
                });

                yourCapital += (sellAmount - fees);
                totalFeesPaid += fees;
                totalSlippageCost += slippageCost;

                if (pos.sharesHeld < 0.01) {
                    pos.closed = true;
                    // Calculate final P&L
                    const totalBought = pos.trades
                        .filter((t) => t.side === 'BUY')
                        .reduce((sum, t) => sum + t.usdcSize, 0);
                    const totalSold = pos.trades
                        .filter((t) => t.side === 'SELL')
                        .reduce((sum, t) => sum + t.usdcSize, 0);
                    pos.pnl = totalSold - totalBought;
                }

                copiedTrades++;
            } else {
                skippedTrades++;
            }
        }
    }

    // Calculate current values based on trader's current positions
    const traderPositions = await fetchTraderPositions();
    let totalCurrentValue = yourCapital;
    let unrealizedPnl = 0;
    let realizedPnl = 0;

    for (const [key, simPos] of positions.entries()) {
        if (!simPos.closed) {
            // Find matching trader position to get current value
            const assetId = key.split(':')[0];
            const traderPos = traderPositions.find((tp) => tp.asset === assetId);

            if (traderPos) {
                const currentPrice = traderPos.currentValue / traderPos.size;
                // Use tracked sharesHeld instead of recalculating
                simPos.currentValue = simPos.sharesHeld * currentPrice;
            }

            simPos.pnl = simPos.currentValue - simPos.invested;
            unrealizedPnl += simPos.pnl;
            totalCurrentValue += simPos.currentValue;
        } else {
            // Closed position - P&L already calculated
            realizedPnl += simPos.pnl;
        }
    }

    const currentCapital =
        yourCapital +
        Array.from(positions.values())
            .filter((p) => !p.closed)
            .reduce((sum, p) => sum + p.currentValue, 0);

    const totalPnl = currentCapital - STARTING_CAPITAL;
    const roi = (totalPnl / STARTING_CAPITAL) * 100;

    // Add final equity point
    const finalEquity = currentCapital;
    const peak = equityCurve.length > 0
        ? Math.max(...equityCurve.map(e => e.equity), finalEquity)
        : finalEquity;
    equityCurve.push({
        timestamp: Math.floor(Date.now() / 1000),
        date: new Date().toISOString().split('T')[0],
        equity: finalEquity,
        drawdown: peak - finalEquity,
        drawdownPct: peak > 0 ? ((peak - finalEquity) / peak) * 100 : 0,
    });

    // Calculate risk metrics
    const closedPositions = Array.from(positions.values()).filter(p => p.closed);
    const riskMetrics = calculateRiskMetrics(equityCurve, closedPositions, STARTING_CAPITAL);

    return {
        id: `sim_${TRADER_ADDRESS.slice(0, 8)}_${Date.now()}`,
        name: `FIXED_${TRADER_ADDRESS.slice(0, 6)}_${HISTORY_DAYS}d_copy${COPY_PERCENTAGE}pct`,
        logic: 'realistic_slippage',
        timestamp: Date.now(),
        traderAddress: TRADER_ADDRESS,
        startingCapital: STARTING_CAPITAL,
        currentCapital,
        totalTrades: trades.length,
        copiedTrades,
        skippedTrades,
        totalInvested,
        currentValue: totalCurrentValue,
        realizedPnl,
        unrealizedPnl,
        totalPnl,
        roi,
        positions: Array.from(positions.values()),
        // New realistic simulation fields
        totalFeesPaid,
        totalSlippageCost,
        equityCurve,
        riskMetrics,
    };
}

function printReport(result: SimulationResult) {
    console.log('\n' + colors.cyan('═'.repeat(80)));
    console.log(colors.cyan('  📊 COPY TRADING SIMULATION REPORT (REALISTIC)'));
    console.log(colors.cyan('═'.repeat(80)) + '\n');

    console.log('Trader:', colors.blue(result.traderAddress));
    console.log(
        'Copy %:',
        colors.yellow(`${COPY_PERCENTAGE}%`),
        colors.gray('(of trader order size)')
    );
    console.log('Multiplier:', colors.yellow(`${MULTIPLIER}x`));
    console.log();

    console.log(colors.bold('Capital:'));
    console.log(`  Starting: ${colors.green('$' + result.startingCapital.toFixed(2))}`);
    console.log(`  Current:  ${colors.green('$' + result.currentCapital.toFixed(2))}`);
    console.log();

    console.log(colors.bold('Performance:'));
    const pnlColor = result.totalPnl >= 0 ? colors.green : colors.red;
    const roiColor = result.roi >= 0 ? colors.green : colors.red;
    const pnlSign = result.totalPnl >= 0 ? '+' : '';
    const roiSign = result.roi >= 0 ? '+' : '';
    console.log(`  Total P&L:     ${pnlColor(pnlSign + '$' + result.totalPnl.toFixed(2))}`);
    console.log(`  ROI:           ${roiColor(roiSign + result.roi.toFixed(2) + '%')}`);
    console.log(
        `  Realized:      ${result.realizedPnl >= 0 ? '+' : ''}$${result.realizedPnl.toFixed(2)}`
    );
    console.log(
        `  Unrealized:    ${result.unrealizedPnl >= 0 ? '+' : ''}$${result.unrealizedPnl.toFixed(2)}`
    );
    console.log();

    // NEW: Costs section
    console.log(colors.bold('💸 Costs (Realistic):'));
    console.log(`  Fees Paid:     ${colors.red('-$' + result.totalFeesPaid.toFixed(2))}`);
    console.log(`  Slippage Cost: ${colors.red('-$' + result.totalSlippageCost.toFixed(2))}`);
    console.log(`  Total Costs:   ${colors.red('-$' + (result.totalFeesPaid + result.totalSlippageCost).toFixed(2))}`);
    console.log();

    // NEW: Risk Metrics section
    console.log(colors.bold('📈 Risk Metrics:'));
    const rm = result.riskMetrics;
    const sharpeColor = rm.sharpeRatio >= 1 ? colors.green : rm.sharpeRatio >= 0 ? colors.yellow : colors.red;
    console.log(`  Sharpe Ratio:  ${sharpeColor(rm.sharpeRatio.toFixed(2))}`);
    console.log(`  Max Drawdown:  ${colors.red('-$' + rm.maxDrawdown.toFixed(2))} (${rm.maxDrawdownPct.toFixed(1)}%)`);
    console.log(`  Win Rate:      ${rm.winRate.toFixed(1)}% (${rm.totalWins}W / ${rm.totalLosses}L)`);
    if (rm.profitFactor !== Infinity) {
        console.log(`  Profit Factor: ${rm.profitFactor >= 1 ? colors.green(rm.profitFactor.toFixed(2)) : colors.red(rm.profitFactor.toFixed(2))}`);
    }
    if (rm.totalWins > 0 || rm.totalLosses > 0) {
        console.log(`  Avg Win:       ${colors.green('+$' + rm.avgWin.toFixed(2))}`);
        console.log(`  Avg Loss:      ${colors.red('-$' + rm.avgLoss.toFixed(2))}`);
    }
    console.log();

    console.log(colors.bold('Trades:'));
    console.log(`  Total trades:  ${colors.cyan(String(result.totalTrades))}`);
    console.log(`  Copied:        ${colors.green(String(result.copiedTrades))}`);
    console.log(
        `  Skipped:       ${colors.yellow(String(result.skippedTrades))} (below $${MIN_ORDER_SIZE} minimum)`
    );
    console.log();

    const openPositions = result.positions.filter((p) => !p.closed);
    const closedPositions = result.positions.filter((p) => p.closed);

    console.log(colors.bold('Open Positions:'));
    console.log(`  Count: ${openPositions.length}\n`);

    openPositions.slice(0, 10).forEach((pos, i) => {
        const pnlStr =
            pos.pnl >= 0
                ? colors.green(`+$${pos.pnl.toFixed(2)}`)
                : colors.red(`-$${Math.abs(pos.pnl).toFixed(2)}`);
        const marketLabel = (pos.market || 'Unknown market').slice(0, 50);
        console.log(`  ${i + 1}. ${marketLabel}`);
        console.log(
            `     Outcome: ${pos.outcome} | Invested: $${pos.invested.toFixed(2)} | Value: $${pos.currentValue.toFixed(2)} | P&L: ${pnlStr}`
        );
    });

    if (openPositions.length > 10) {
        console.log(colors.gray(`\n  ... and ${openPositions.length - 10} more positions`));
    }

    if (closedPositions.length > 0) {
        console.log('\n' + colors.bold('Closed Positions:'));
        console.log(`  Count: ${closedPositions.length}\n`);

        closedPositions.slice(0, 5).forEach((pos, i) => {
            const pnlStr =
                pos.pnl >= 0
                    ? colors.green(`+$${pos.pnl.toFixed(2)}`)
                    : colors.red(`-$${Math.abs(pos.pnl).toFixed(2)}`);
            const marketLabel = (pos.market || 'Unknown market').slice(0, 50);
            console.log(`  ${i + 1}. ${marketLabel}`);
            console.log(`     Outcome: ${pos.outcome} | P&L: ${pnlStr}`);
        });

        if (closedPositions.length > 5) {
            console.log(
                colors.gray(`\n  ... and ${closedPositions.length - 5} more closed positions`)
            );
        }
    }

    console.log('\n' + colors.cyan('═'.repeat(80)) + '\n');
}

async function main() {
    console.log(colors.cyan('\n🚀 POLYMARKET COPY TRADING PROFITABILITY SIMULATOR (FIXED)\n'));
    console.log(colors.gray(`Trader: ${TRADER_ADDRESS}`));
    console.log(colors.gray(`Starting Capital: $${STARTING_CAPITAL}`));
    console.log(colors.gray(`Copy Percentage: ${COPY_PERCENTAGE}% (of trader order size)`));
    console.log(colors.gray(`Multiplier: ${MULTIPLIER}x`));
    console.log(
        colors.gray(`History window: ${HISTORY_DAYS} day(s), max trades: ${MAX_TRADES_LIMIT}\n`)
    );

    try {
        const trades = await fetchTraderActivity();
        const result = await simulateCopyTrading(trades);
        printReport(result);

        // Save to JSON file
        const fs = await import('fs');
        const path = await import('path');
        const resultsDir = path.join(process.cwd(), 'simulation_results');

        if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir, { recursive: true });
        }

        const tag = (() => {
            const raw = process.env.SIM_RESULT_TAG;
            if (!raw) return '';
            return '_' + raw.trim().replace(/[^a-zA-Z0-9-_]+/g, '-');
        })();
        const filename = `fixed_logic_${TRADER_ADDRESS}_${HISTORY_DAYS}d_copy${COPY_PERCENTAGE}pct${tag}_${new Date().toISOString().split('T')[0]}.json`;
        const filepath = path.join(resultsDir, filename);

        fs.writeFileSync(filepath, JSON.stringify(result, null, 2), 'utf8');
        console.log(colors.green(`✓ Results saved to: ${filepath}\n`));

        console.log(colors.green('✓ Simulation completed successfully!\n'));
    } catch (error) {
        console.error(colors.red('\n✗ Simulation failed:'), error);
        process.exit(1);
    }
}

main();
