
import fs from 'fs';
import path from 'path';
import connectDB, { closeDB } from '../config/db';
import { ENV } from '../config/env';
import { getUserActivityModel } from '../models/userHistory';
import fetchData from '../utils/fetchData';
import mongoose from 'mongoose';

interface TradeActivity {
    timestamp: number;
    type: string;
    size: number;
    usdcSize: number;
    price: number;
    asset: string;
    side: 'BUY' | 'SELL';
    title?: string;
    outcome?: string;
    transactionHash: string;
}

interface Inventory {
    size: number;
    avgPrice: number;
}

const generateChartHtml = (
    dataPoints: { date: string; pnl: number; totalPnl: number }[],
    unrealizedPnl: number,
    realizedPnl: number,
    totalValue: number,
    initialValue: number
) => {
    const labels = dataPoints.map((d) => d.date);
    const pnlData = dataPoints.map((d) => d.totalPnl);

    // Create a stepped line for better visualization of discrete trade events
    // or just a normal line. Normal line is fine.

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Profit/Loss Over Time</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; background-color: #f4f4f9; color: #333; }
        .container { max-width: 1000px; margin: 0 auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        h1 { text-align: center; color: #2c3e50; margin-bottom: 30px; }

        .summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 30px; }
        .summary-card { background: #f8f9fa; border-radius: 8px; padding: 20px; border: 1px solid #dee2e6; }
        .summary-title { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #6c757d; margin-bottom: 5px; }
        .summary-value { font-size: 28px; font-weight: bold; }

        .positive { color: #28a745; }
        .negative { color: #dc3545; }
        .neutral { color: #6c757d; }

        .chart-container { position: relative; height: 400px; width: 100%; }

        .note { margin-top: 20px; font-size: 14px; color: #666; font-style: italic; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Portfolio Performance</h1>

        <div class="summary-grid">
            <div class="summary-card">
                <div class="summary-title">Realized P/L</div>
                <div class="summary-value ${realizedPnl >= 0 ? 'positive' : 'negative'}">
                    $${realizedPnl.toFixed(2)}
                </div>
                <small>Closed positions</small>
            </div>
            <div class="summary-card">
                <div class="summary-title">Unrealized P/L</div>
                <div class="summary-value ${unrealizedPnl >= 0 ? 'positive' : 'negative'}">
                    $${unrealizedPnl.toFixed(2)}
                </div>
                <small>Open positions</small>
            </div>
            <div class="summary-card">
                <div class="summary-title">Portfolio Value</div>
                <div class="summary-value neutral">$${totalValue.toFixed(2)}</div>
            </div>
             <div class="summary-card">
                <div class="summary-title">Initial Investment</div>
                <div class="summary-value neutral">$${initialValue.toFixed(2)}</div>
            </div>
        </div>

        <div class="chart-container">
            <canvas id="pnlChart"></canvas>
        </div>

        <p class="note">Note: The chart below shows REALIZED Profit/Loss over time. Unrealized gains/losses are not reflected until you sell.</p>
    </div>

    <script>
        const ctx = document.getElementById('pnlChart').getContext('2d');
        const data = {
            labels: ${JSON.stringify(labels)},
            datasets: [{
                label: 'Cumulative Realized PnL (USD)',
                data: ${JSON.stringify(pnlData)},
                borderColor: '#007bff',
                backgroundColor: 'rgba(0, 123, 255, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.1,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        };

        const config = {
            type: 'line',
            data: data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        display: true,
                        title: {
                            display: true,
                            text: 'Date'
                        },
                        ticks: {
                            maxTicksLimit: 10
                        }
                    },
                    y: {
                        display: true,
                        title: {
                            display: true,
                            text: 'PnL ($)'
                        }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        };

        new Chart(ctx, config);
    </script>
</body>
</html>
    `;
    return htmlContent;
};

const syncTrades = async (walletAddress: string, ActivityModel: any) => {
    console.log('🔄 Syncing trade history from Polymarket API...');
    try {
        const apiUrl = `https://data-api.polymarket.com/activity?user=${walletAddress}&type=TRADE`;
        const activities = await fetchData(apiUrl);

        if (!Array.isArray(activities) || activities.length === 0) {
            console.log('   No trades found on API.');
            return;
        }

        console.log(`   Found ${activities.length} trades on API. Updating DB...`);

        let newCount = 0;
        for (const activity of activities) {
            // Check if exists
            const existing = await ActivityModel.findOne({ transactionHash: activity.transactionHash });
            if (!existing) {
                await ActivityModel.create({
                    ...activity,
                    proxyWallet: walletAddress, // Ensure proxyWallet is set if missing in API response
                    bot: false // Assuming manual or untracked
                });
                newCount++;
            }
        }
        console.log(`   ✅ Synced ${newCount} new trades to database.`);
    } catch (error) {
        console.error('   ❌ Error syncing trades:', error);
    }
};

const chartPnL = async () => {
    try {
        await connectDB();

        const walletAddress = ENV.PROXY_WALLET;
        console.log(`\n📊 Generating P/L Chart for: ${walletAddress}`);

        const ActivityModel = getUserActivityModel(walletAddress);

        // 1. Sync data first
        await syncTrades(walletAddress, ActivityModel);

        // 2. Fetch current positions for Unrealized stats
        let totalUnrealizedPnl = 0;
        let totalValue = 0;
        let totalInitialValue = 0;

        try {
            console.log('🔄 Fetching current open positions...');
            const positionsUrl = `https://data-api.polymarket.com/positions?user=${walletAddress}`;
            const positions = await fetchData(positionsUrl);

            if (Array.isArray(positions)) {
                 positions.forEach((pos: any) => {
                    totalUnrealizedPnl += pos.cashPnl || 0;
                    totalValue += pos.currentValue || 0;
                    totalInitialValue += pos.initialValue || 0;
                });
            }
            console.log(`   Current Unrealized P/L: $${totalUnrealizedPnl.toFixed(2)}`);
        } catch (err) {
            console.warn('   Warning: Could not fetch open positions for stats.');
        }

        // 3. Calculate Realized PnL from DB
        const activities = await ActivityModel.find({
            type: 'TRADE'
        }).sort({ timestamp: 1 }).lean();

        console.log(`\n📅 Processing ${activities.length} historical trades for chart...`);

        // Inventory tracking
        const inventory: Record<string, Inventory> = {};
        let cumulativePnL = 0;
        const dataPoints: { date: string; pnl: number; totalPnl: number }[] = [];

        if (activities.length > 0) {
            // Initial point
            dataPoints.push({
                date: new Date((activities[0] as TradeActivity).timestamp * 1000).toLocaleString(),
                pnl: 0,
                totalPnl: 0
            });
        }

        for (const activity of activities) {
            const trade = activity as unknown as TradeActivity;
            const assetId = trade.asset;

            if (!inventory[assetId]) {
                inventory[assetId] = { size: 0, avgPrice: 0 };
            }

            const currentInv = inventory[assetId];

            if (trade.side === 'BUY') {
                const totalCost = (currentInv.size * currentInv.avgPrice) + (trade.size * trade.price);
                const totalSize = currentInv.size + trade.size;

                if (totalSize === 0) {
                    currentInv.avgPrice = 0;
                    currentInv.size = 0;
                } else {
                    currentInv.avgPrice = totalCost / totalSize;
                    currentInv.size = totalSize;
                }
            }
            else if (trade.side === 'SELL') {
                const sizeToSell = Math.min(trade.size, currentInv.size > 0 ? currentInv.size : trade.size);
                const realizedPnL = (trade.price - currentInv.avgPrice) * sizeToSell;

                cumulativePnL += realizedPnL;

                currentInv.size -= trade.size;
                if (currentInv.size <= 0) {
                    currentInv.size = 0;
                    currentInv.avgPrice = 0;
                }

                // Add data point on Sell
                dataPoints.push({
                    date: new Date(trade.timestamp * 1000).toLocaleString(),
                    pnl: realizedPnL,
                    totalPnl: cumulativePnL
                });
            }
        }

        // If we only have buys, we should at least show a point at the end with 0 pnl so the chart isn't empty
        if (dataPoints.length === 1 && activities.length > 0) {
             dataPoints.push({
                date: new Date().toLocaleString(),
                pnl: 0,
                totalPnl: 0
            });
        }

        console.log(`   Realized PnL: $${cumulativePnL.toFixed(2)}`);

        // Generate HTML
        const html = generateChartHtml(
            dataPoints,
            totalUnrealizedPnl,
            cumulativePnL,
            totalValue,
            totalInitialValue
        );

        const reportsDir = path.join(process.cwd(), 'reports');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        const outputPath = path.join(reportsDir, 'profit_loss_chart.html');
        fs.writeFileSync(outputPath, html);

        console.log(`\n✅ Chart generated successfully!`);
        console.log(`📄 Open file://${outputPath} in your browser to view.`);

    } catch (error) {
        console.error('Error calculating PnL:', error);
    } finally {
        await closeDB();
    }
};

chartPnL();
