# Position Tracking

This document explains how the bot tracks positions and calculates P&L.

## Position Data Sources

### Polymarket API

The bot fetches position data from Polymarket's data API:

```
https://data-api.polymarket.com/positions?user=WALLET_ADDRESS
```

This returns all open positions including:
- Token ID (the specific outcome token)
- Condition ID (the market)
- Size (number of tokens)
- Average entry price
- Current value
- Unrealized P&L

### MongoDB Storage

The bot stores additional tracking data in MongoDB:
- Entry timestamps
- Original trade signals
- Peak prices (for trailing stops)

---

## Position Lifecycle

### 1. Signal Generated

When edge is detected:
```
Signal: BUY "40-44°F" @ $0.35 (fair: $0.42, edge: 7%)
```

### 2. Order Placed

Limit order sent to CLOB:
```
Order placed: "40-44°F" @ $0.35 for $10.00
```

### 3. Position Opened

After fill, position is tracked:
```
Position: 28.57 tokens @ $0.35 avg
```

### 4. Position Monitored

Bot continuously monitors:
- Current price vs entry
- P&L percentage
- SL/TP/Trailing stop triggers

### 5. Position Closed

Either by:
- Market resolution
- Stop-loss trigger
- Take-profit trigger
- Trailing stop trigger
- Manual sale

---

## P&L Calculation

### Unrealized P&L

```
Unrealized P&L ($) = current_value - cost_basis
Unrealized P&L (%) = ((current_price / avg_entry_price) - 1) × 100
```

**Example**:
- Bought 28.57 tokens @ $0.35 = $10.00 cost
- Current price: $0.42
- Current value: 28.57 × 0.42 = $12.00
- Unrealized P&L: $2.00 (+20%)

### Realized P&L

When position closes:
```
Realized P&L = exit_value - cost_basis
```

---

## Resolution Outcomes

### Market Resolves YES

If you hold YES tokens for the correct outcome:
- Tokens redeem for $1.00 each
- P&L = $1.00 × tokens - cost_basis

### Market Resolves NO

If you hold tokens for incorrect outcome:
- Tokens worth $0.00
- Loss = -cost_basis

### Automatic Redemption

The bot's redemption service automatically claims winnings from resolved markets.

---

## Viewing Positions

### Discord Commands

```
/positions - List all open positions with pagination
/stats - Portfolio summary with total P&L
```

### Console Logs

Position updates appear in logs:
```
📊 Position Manager: Checking 3 positions for SL/TP triggers
```

### Polymarket Website

View directly at:
```
https://polymarket.com/portfolio
```

---

## Stop-Loss / Take-Profit

### Stop-Loss Triggers

When position drops below threshold:
```
🛑 STOP-LOSS triggered for "NYC Temperature Jan 20"
   Current P&L: -25.0%, Size: 28.57 tokens
   Sold 28.57 tokens at $0.26
```

### Take-Profit Triggers

When position rises above threshold:
```
💰 TAKE-PROFIT triggered for "NYC Temperature Jan 20"
   Current P&L: +50.0%, Size: 28.57 tokens
   Sold 28.57 tokens at $0.52
```

### Trailing Stop Triggers

When price drops from peak:
```
📉 TRAILING-STOP triggered for "NYC Temperature Jan 20"
   Current P&L: +35.0%, Peak P&L: +55.0%
   Sold 28.57 tokens at $0.47
```

---

## Database Schema

### Bot Positions Collection

```javascript
{
  conditionId: "0x...",
  asset: "token_id",
  tokensHeld: 28.57,
  totalInvested: 10.00,
  avgEntryPrice: 0.35,
  createdAt: "2026-01-15T...",
  updatedAt: "2026-01-15T..."
}
```

### Peak Tracking (State Persistence)

```javascript
{
  key: "position_peaks",
  value: {
    "0x...condition_id": {
      peakPrice: 0.55,
      peakPnlPercent: 55.0
    }
  }
}
```

---

## Troubleshooting

### Positions not showing

1. Check MongoDB connection
2. Verify wallet address in `.env`
3. Check Polymarket API directly

### P&L incorrect

1. Price data may be cached
2. Wait for refresh cycle
3. Check Polymarket website for live data

### SL/TP not triggering

1. Check `POSITION_CHECK_INTERVAL_MS`
2. Verify SL/TP is enabled in `.env`
3. Check logs for position manager errors
