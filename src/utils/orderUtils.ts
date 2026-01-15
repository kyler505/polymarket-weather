/**
 * Order Utilities
 * Helper functions for order book analysis
 */

export interface OrderBookLevel {
    price: string;
    size: string;
}

/**
 * Get the best (highest) bid from a list of order book bids
 */
export function getBestBid(bids: OrderBookLevel[]): OrderBookLevel | null {
    if (!bids || bids.length === 0) return null;

    // Bids should already be sorted by price descending, but let's ensure
    let bestBid = bids[0];
    for (const bid of bids) {
        if (parseFloat(bid.price) > parseFloat(bestBid.price)) {
            bestBid = bid;
        }
    }
    return bestBid;
}

/**
 * Get the best (lowest) ask from a list of order book asks
 */
export function getBestAsk(asks: OrderBookLevel[]): OrderBookLevel | null {
    if (!asks || asks.length === 0) return null;

    // Asks should already be sorted by price ascending
    let bestAsk = asks[0];
    for (const ask of asks) {
        if (parseFloat(ask.price) < parseFloat(bestAsk.price)) {
            bestAsk = ask;
        }
    }
    return bestAsk;
}

/**
 * Calculate the mid price from best bid and best ask
 */
export function getMidPrice(bids: OrderBookLevel[], asks: OrderBookLevel[]): number | null {
    const bestBid = getBestBid(bids);
    const bestAsk = getBestAsk(asks);

    if (!bestBid || !bestAsk) return null;

    return (parseFloat(bestBid.price) + parseFloat(bestAsk.price)) / 2;
}
