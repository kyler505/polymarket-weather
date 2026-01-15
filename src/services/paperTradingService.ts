/**
 * Paper Trading Service
 * Manages mock trades and tracks performance for dry runs
 */

import fs from 'fs';
import path from 'path';
import { Side } from '@polymarket/clob-client';
import Logger from '../utils/logger';

const DATA_DIR = path.join(process.cwd(), 'data');
const PAPER_TRADES_FILE = path.join(DATA_DIR, 'paper_trades.json');

export interface PaperTrade {
    id: string;
    timestamp: string;
    marketTitle: string;
    outcomeLabel: string;
    side: 'BUY' | 'SELL';
    price: number;
    amountUSD: number;
    shares: number;
    conditionId: string;
    assetId: string;
}

export interface PaperPortfolio {
    balance: number;
    positions: Record<string, number>; // assetId -> shares
    trades: PaperTrade[];
}

export class PaperTradingService {
    private static instance: PaperTradingService;
    private portfolio: PaperPortfolio;

    private constructor() {
        this.portfolio = this.loadPortfolio();
    }

    public static getInstance(): PaperTradingService {
        if (!PaperTradingService.instance) {
            PaperTradingService.instance = new PaperTradingService();
        }
        return PaperTradingService.instance;
    }

    private loadPortfolio(): PaperPortfolio {
        try {
            if (fs.existsSync(PAPER_TRADES_FILE)) {
                const data = fs.readFileSync(PAPER_TRADES_FILE, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            Logger.error(`Failed to load paper trades: ${error}`);
        }

        // Default initial state
        return {
            balance: 1000, // Start with $1000 fake money
            positions: {},
            trades: []
        };
    }

    private savePortfolio(): void {
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            fs.writeFileSync(PAPER_TRADES_FILE, JSON.stringify(this.portfolio, null, 2));
        } catch (error) {
            Logger.error(`Failed to save paper trades: ${error}`);
        }
    }

    public recordTrade(trade: Omit<PaperTrade, 'id' | 'timestamp' | 'shares'>): void {
        // Simulate spread/slippage for realism (Pessimistic Paper Trading)
        // Buy higher, Sell lower
        const SPREAD = 0.02; // 2% spread adjustment
        let effectivePrice = trade.price;

        if (trade.side === 'BUY') {
            effectivePrice = Math.min(0.99, trade.price + (SPREAD / 2));
        } else {
            effectivePrice = Math.max(0.01, trade.price - (SPREAD / 2));
        }

        const shares = trade.amountUSD / effectivePrice;
        const newTrade: PaperTrade = {
            ...trade,
            price: effectivePrice, // Use the effective price
            id: Math.random().toString(36).substring(7),
            timestamp: new Date().toISOString(),
            shares
        };

        this.portfolio.trades.push(newTrade);

        // Update Balance
        if (trade.side === 'BUY') {
            this.portfolio.balance -= trade.amountUSD;
            // Add shares
            this.portfolio.positions[trade.assetId] = (this.portfolio.positions[trade.assetId] || 0) + shares;
        } else {
            this.portfolio.balance += trade.amountUSD;
            // Remove shares
            this.portfolio.positions[trade.assetId] = (this.portfolio.positions[trade.assetId] || 0) - shares;
        }

        this.savePortfolio();

        Logger.success(`[PAPER] Recorded ${trade.side} ${trade.amountUSD.toFixed(2)} of ${trade.outcomeLabel} @ ${effectivePrice.toFixed(3)} (incl. spread)`);
        Logger.info(`[PAPER] New Balance: $${this.portfolio.balance.toFixed(2)}`);
    }

    public getBalance(): number {
        return this.portfolio.balance;
    }

    public getPosition(assetId: string): number {
        return this.portfolio.positions[assetId] || 0;
    }
}
