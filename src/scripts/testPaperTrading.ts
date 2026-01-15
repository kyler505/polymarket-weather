/**
 * Test Paper Trading Script
 * Verifies that the PaperTradingService correctly records trades and updates portfolio.
 *
 * Usage: npx ts-node src/scripts/testPaperTrading.ts
 */

import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { PaperTradingService } from '../services/paperTradingService';

async function testPaperTrading() {
    console.log(chalk.cyan.bold('🧪 Testing Paper Trading Service'));
    console.log(chalk.cyan('================================='));

    const service = PaperTradingService.getInstance();
    const initialBalance = service.getBalance();

    console.log(`Initial Balance: $${initialBalance.toFixed(2)}`);

    // Simulate a BUY trade
    const buyTrade = {
        marketTitle: 'Will NYC be > 50F on Jan 1?',
        outcomeLabel: '>50F',
        side: 'BUY' as const,
        price: 0.40,
        amountUSD: 100.00,
        conditionId: 'test-condition-1',
        assetId: 'test-asset-1'
    };

    console.log(chalk.yellow(`\n📝 Recording BUY trade: $${buyTrade.amountUSD} of ${buyTrade.outcomeLabel} @ ${buyTrade.price}`));
    service.recordTrade(buyTrade);

    const afterBuyBalance = service.getBalance();
    const position = service.getPosition(buyTrade.assetId);

    console.log(`Balance after BUY: $${afterBuyBalance.toFixed(2)} (Expected: $${(initialBalance - 100).toFixed(2)})`);
    console.log(`Position shares: ${position} (Expected: 250)`);

    if (Math.abs(afterBuyBalance - (initialBalance - 100)) < 0.01 && position === 250) {
        console.log(chalk.green('✓ BUY logic verified'));
    } else {
        console.error(chalk.red('✗ BUY logic failed'));
    }

    // Simulate a SELL trade (closing position)
    const sellTrade = {
        marketTitle: 'Will NYC be > 50F on Jan 1?',
        outcomeLabel: '>50F',
        side: 'SELL' as const,
        price: 0.60,
        amountUSD: 150.00, // Selling 250 shares @ 0.60
        conditionId: 'test-condition-1',
        assetId: 'test-asset-1'
    };

    console.log(chalk.yellow(`\n📝 Recording SELL trade: $${sellTrade.amountUSD} of ${sellTrade.outcomeLabel} @ ${sellTrade.price}`));
    service.recordTrade(sellTrade);

    const finalBalance = service.getBalance();
    const finalPosition = service.getPosition(sellTrade.assetId);

    console.log(`Final Balance: $${finalBalance.toFixed(2)} (Expected: $${(initialBalance - 100 + 150).toFixed(2)})`);
    console.log(`Final shares: ${finalPosition} (Expected: 0)`);

    if (Math.abs(finalBalance - (initialBalance + 50)) < 0.01 && finalPosition === 0) {
        console.log(chalk.green('✓ SELL logic verified'));
    } else {
        console.error(chalk.red('✗ SELL logic failed'));
    }

    // Verify file persistence
    const dataPath = path.join(process.cwd(), 'data', 'paper_trades.json');
    if (fs.existsSync(dataPath)) {
        console.log(chalk.green(`\n✓ ${dataPath} exists`));
        const content = fs.readFileSync(dataPath, 'utf8');
        const data = JSON.parse(content);
        console.log(`File contains ${data.trades.length} trades`);
    } else {
        console.error(chalk.red(`\n✗ ${dataPath} not found`));
    }
}

testPaperTrading().catch(console.error);
