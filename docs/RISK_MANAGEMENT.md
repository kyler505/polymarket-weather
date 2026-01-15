# Risk Management Guide

This document explains the risk management features of the Weather Prediction Bot.

## Overview

Weather prediction markets carry inherent risks:
- **Forecast uncertainty**: Weather forecasts can be wrong
- **Correlation risk**: Multiple markets resolving on the same day
- **Geographic concentration**: Many markets for the same city
- **Liquidity risk**: Thin markets with high slippage
- **Data quality risk**: Stale or incorrect weather data

The bot implements multiple layers of protection against these risks.

---

## Exposure Limits

### Per-Market Exposure

**Purpose**: Limit loss from any single market going against you.

**Configuration**:
```bash
MAX_EXPOSURE_PER_MARKET_USD=50
```

**How it works**:
- Before placing a trade, check current exposure to that market
- If (current + new_trade) > limit, skip the trade
- Exposure tracks the USD value at risk, not just position size

**Recommendation**: Start with $25-50 per market while learning.

---

### Per-Region Exposure

**Purpose**: Prevent geographic concentration risk.

**Configuration**:
```bash
MAX_EXPOSURE_PER_REGION_USD=200
```

**Regions**:
- Northeast: NYC, Boston, DC
- Midwest: Chicago, Detroit, Minneapolis
- South: Dallas, Houston, Miami, Atlanta
- West: LA, SF, Seattle, Denver

**How it works**:
- Maps each station to a region
- Tracks total exposure per region
- Blocks trades that would exceed regional limit

**Why it matters**: Weather patterns are correlated within regions. A cold front hitting the Northeast affects multiple cities simultaneously.

---

### Per-Date Exposure

**Purpose**: Limit same-day resolution risk.

**Configuration**:
```bash
MAX_EXPOSURE_PER_DATE_USD=100
```

**How it works**:
- Groups markets by resolution date
- Limits total exposure for all markets resolving on same day

**Why it matters**: If your forecast model is systematically wrong for that day (e.g., unexpected weather event), all same-day positions lose together.

---

## Daily Loss Limit

**Purpose**: Stop trading after significant losses to prevent tilt and over-exposure.

**Configuration**:
```bash
MAX_DAILY_LOSS_USD=100
```

**How it works**:
1. Track running P&L throughout the day
2. When daily P&L drops below -$100, automatically pause trading
3. Bot resumes at midnight (new trading day)
4. Can also manually resume with `/resume` Discord command

**Recommendation**: Set to 1-2% of your total capital.

---

## Data Freshness Kill-Switch

**Purpose**: Stop trading if weather data becomes stale.

**Configuration**:
```bash
MAX_DATA_AGE_MS=3600000  # 1 hour
```

**How it works**:
- Track timestamp of last successful data fetch
- If data is older than threshold, block new trades
- Existing positions remain open

**Why it matters**: Trading on stale forecasts can lead to systematic losses if weather has changed significantly.

---

## Order Protections

### Minimum Order Size

**Configuration**:
```bash
MIN_ORDER_SIZE_USD=1.0
```

**Purpose**: Avoid dust trades that cost more in fees than they're worth.

### Maximum Order Size

**Configuration**:
```bash
MAX_ORDER_SIZE_USD=25.0
```

**Purpose**: Limit single-order impact and slippage.

### Slippage Protection

**Configuration**:
```bash
MAX_SLIPPAGE_PERCENT=3.0
```

**Purpose**: Reject trades with excessive price slippage.

**How it works**:
- Compare expected price to actual execution price
- If slippage > 3%, skip the trade

---

## Position Management

### Stop-Loss

**Configuration**:
```bash
STOP_LOSS_ENABLED=true
STOP_LOSS_PERCENT=25
```

**Purpose**: Limit downside on individual positions.

**How it works**:
- Monitor position P&L
- If down 25% from entry, sell automatically

### Take-Profit

**Configuration**:
```bash
TAKE_PROFIT_ENABLED=true
TAKE_PROFIT_PERCENT=50
```

**Purpose**: Lock in gains on winning positions.

**How it works**:
- Monitor position P&L
- If up 50% from entry, sell automatically

### Trailing Stop

**Configuration**:
```bash
TRAILING_STOP_ENABLED=true
TRAILING_STOP_PERCENT=15
```

**Purpose**: Protect gains while allowing upside.

**How it works**:
- Track peak P&L for each position
- If price drops 15% from peak, sell
- Only triggers after position has been profitable

---

## Manual Controls

### Pause Trading

**Discord**: `/pause`

**Effect**:
- Stops all new trade execution
- Existing positions remain open
- Position manager continues (SL/TP still active)

### Resume Trading

**Discord**: `/resume`

**Effect**:
- Resumes normal trading operations
- Only available when bot is paused

---

## Monitoring

### Discord /exposure Command

Shows current exposure breakdown:
- Total exposure across all markets
- Exposure by region
- Exposure by date
- Daily P&L
- Pause status (if paused)

### Discord /status Command

Shows health status:
- Monitor running status
- Data freshness
- Any active issues/warnings

---

## Recommended Settings by Capital Size

### Small ($100-500)
```bash
MAX_EXPOSURE_PER_MARKET_USD=10
MAX_EXPOSURE_PER_REGION_USD=30
MAX_EXPOSURE_PER_DATE_USD=20
MAX_DAILY_LOSS_USD=20
MAX_ORDER_SIZE_USD=5
```

### Medium ($500-2000)
```bash
MAX_EXPOSURE_PER_MARKET_USD=25
MAX_EXPOSURE_PER_REGION_USD=100
MAX_EXPOSURE_PER_DATE_USD=50
MAX_DAILY_LOSS_USD=50
MAX_ORDER_SIZE_USD=15
```

### Large ($2000+)
```bash
MAX_EXPOSURE_PER_MARKET_USD=50
MAX_EXPOSURE_PER_REGION_USD=200
MAX_EXPOSURE_PER_DATE_USD=100
MAX_DAILY_LOSS_USD=100
MAX_ORDER_SIZE_USD=25
```

---

## Emergency Procedures

### Bot Unresponsive

1. Check process is running
2. Check MongoDB connection
3. Check RPC endpoint
4. Restart the bot

### Positions Not Closing

1. Use Polymarket web interface to manually close
2. Check bot logs for errors
3. Verify wallet has gas for transactions

### Data Issues

1. Check NOAA/Open-Meteo API status
2. Look for rate limiting errors in logs
3. Data will auto-refresh when APIs recover

---

## Best Practices

1. **Start small**: Use minimum limits while learning
2. **Enable dry run first**: Test before risking real money
3. **Monitor regularly**: Check `/status` daily
4. **Keep reserves**: Don't allocate 100% to the bot
5. **Review P&L**: Check performance weekly
6. **Adjust limits**: Increase gradually as you gain confidence
