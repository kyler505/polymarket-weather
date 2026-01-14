export interface OrderBookLevel {
    price: string;
    size: string;
}

export interface OrderBook {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
}

export interface MarketCondition {
    spread: number;           // Percentage spread between best bid and ask
    depth: number;            // Total liquidity in top 5 levels (USD)
    volatility: 'low' | 'high';
}

/**
 * Analyze order book to determine market conditions
 */
export const analyzeOrderBook = (orderBook: OrderBook): MarketCondition => {
    const { bids, asks } = orderBook;

    // Calculate spread
    const spread = calculateSpread(orderBook);

    // Calculate order book depth (liquidity)
    const depth = calculateDepth(orderBook);

    // Assess volatility based on spread
    const volatility = assessVolatility(spread);

    return {
        spread,
        depth,
        volatility,
    };
};

/**
 * Calculate the bid-ask spread as a percentage
 */
export const calculateSpread = (orderBook: OrderBook): number => {
    const { bids, asks } = orderBook;

    if (!bids || bids.length === 0 || !asks || asks.length === 0) {
        return 100; // No liquidity = assume 100% spread (very volatile)
    }

    // Find best bid (highest) and best ask (lowest)
    const bestBid = math.max(bids.map((b: OrderBookLevel) => parseFloat(b.price)));
    const bestAsk = math.min(asks.map((a: OrderBookLevel) => parseFloat(a.price)));

    if (bestBid <= 0 || bestAsk <= 0) {
        return 100; // Invalid prices
    }

    // Spread as percentage of bid price
    const spread = ((bestAsk - bestBid) / bestBid) * 100;

    return Math.max(0, spread); // Ensure non-negative
};

/**
 * Calculate total liquidity (depth) in top 5 price levels
 * Returns total USD value available
 */
export const calculateDepth = (orderBook: OrderBook): number => {
    const { bids, asks } = orderBook;

    if (!bids || !asks) {
        return 0;
    }

    // Calculate total liquidity on ask side (what we care about for buying)
    // Top 5 levels
    const topAsks = asks.slice(0, 5);
    const askDepth = topAsks.reduce((sum: number, ask: OrderBookLevel) => {
        const size = parseFloat(ask.size);
        const price = parseFloat(ask.price);
        return sum + size * price; // USD value
    }, 0);

    return askDepth;
};

/**
 * Assess market volatility based on spread
 */
export const assessVolatility = (spreadPercent: number): 'low' | 'high' => {
    // If spread > 10%, consider it high volatility
    return spreadPercent > 10 ? 'high' : 'low';
};

// Math helpers for array operations
const math = {
    max: (arr: number[]) => (arr.length > 0 ? Math.max(...arr) : 0),
    min: (arr: number[]) => (arr.length > 0 ? Math.min(...arr) : Infinity),
};

export default {
    analyzeOrderBook,
    calculateSpread,
    calculateDepth,
    assessVolatility,
};
