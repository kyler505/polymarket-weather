# Getting Started with Weather Bot

This guide will walk you through setting up and running the Polymarket Weather Prediction Trading Bot.

## Prerequisites

Before you begin, ensure you have:

1. **Node.js** (v18 or higher)
2. **npm** (comes with Node.js)
3. **MongoDB** database (local or cloud like MongoDB Atlas)
4. **Funded Polymarket wallet** with USDC
5. **Polygon RPC endpoint** (Infura, Alchemy, or similar)
6. **Python 3** (optional, required only for hybrid ML forecasts)

## Quick Setup

### Step 1: Clone and Install

```bash
git clone <repository-url>
cd polymarket-weather-bot
npm install
```

### Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
# Required settings
PROXY_WALLET='0x...'           # Your Polymarket wallet address
PRIVATE_KEY='...'              # Private key for signing
MONGO_URI='mongodb://...'      # MongoDB connection string
RPC_URL='https://...'          # Polygon RPC endpoint
```

### Step 3: Verify Setup

```bash
# Build the project
npm run build

# Discover weather markets (test mode)
npm run discover
```

### Step 4: Start the Bot

```bash
# Start in dry-run mode first (no real trades)
WEATHER_DRY_RUN=true npm start

# When ready for live trading
WEATHER_DRY_RUN=false npm start
```

---

## Understanding the Configuration

### Weather Trading Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `WEATHER_EDGE_THRESHOLD` | `0.05` | Minimum edge (5%) required to trade |
| `WEATHER_MAX_LEAD_DAYS` | `7` | Only trade markets within 7 days |
| `WEATHER_DRY_RUN` | `true` | Test mode - no real trades |
| `WEATHER_MIN_PARSER_CONFIDENCE` | `0.7` | Parser confidence threshold |

### Risk Limits

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_EXPOSURE_PER_MARKET_USD` | `50` | Max $50 per market |
| `MAX_EXPOSURE_PER_REGION_USD` | `200` | Max $200 per city |
| `MAX_EXPOSURE_PER_DATE_USD` | `100` | Max $100 for same-day resolution |
| `MAX_DAILY_LOSS_USD` | `100` | Auto-pause if daily loss exceeds |

### Order Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `MIN_ORDER_SIZE_USD` | `1` | Minimum order size |
| `MAX_ORDER_SIZE_USD` | `25` | Maximum order size |
| `MAX_SLIPPAGE_PERCENT` | `3` | Maximum slippage tolerance |

---

## How It Works

### 1. Market Discovery

The bot searches Polymarket for temperature prediction markets:
- Searches keywords: "temperature", "weather", "highest temp", etc.
- Parses market rules to extract: station ID, target date, bins
- Stores valid markets in MongoDB

### 2. Forecast Ingestion

Fetches weather data from multiple sources:
- **NOAA/NWS**: Primary forecast source
- **Open-Meteo**: Secondary/verification source
- Combines into ensemble forecast

### 3. Probability Calculation

For each market bin:
- Uses Normal distribution with calibrated sigma (uncertainty)
- Applies continuity correction for integer temperatures
- On resolution day: conditions on "max-so-far" observations

### 4. Edge Detection

Compares fair probability to market price:
```
edge = fair_probability - market_price
```

If edge > threshold, generates a trade signal.

### 5. Order Execution

For each signal:
- Checks risk limits (exposure caps)
- Calculates position size (Kelly criterion)
- Places limit order via CLOB API

---

## Monitoring

### Console Logs

The bot logs:
- Market discovery results
- Forecast fetches
- Trade signals
- Order executions
- Risk limit triggers

### Discord Commands

If Discord bot is enabled:

| Command | Description |
|---------|-------------|
| `/stats` | Portfolio overview |
| `/positions` | List open positions |
| `/markets` | Tracked weather markets |
| `/exposure` | Current risk exposure |
| `/config` | Bot configuration |
| `/pause` | Pause trading |
| `/resume` | Resume trading |
| `/status` | Health check |

---

## Troubleshooting

### Bot won't start

1. Check MongoDB connection: `MONGO_URI`
2. Check RPC endpoint: `RPC_URL`
3. Verify wallet has USDC balance

### No markets discovered

1. Check Polymarket has active weather markets
2. Increase `WEATHER_MIN_PARSER_CONFIDENCE`
3. Check logs for parser errors

### Orders not executing

1. Verify `WEATHER_DRY_RUN=false`
2. Check wallet has sufficient USDC
3. Check risk limits aren't exceeded

### Rate limiting

1. Increase `RATE_LIMIT_COOLDOWN_MS`
2. Increase `EXECUTOR_POLL_INTERVAL_MS`

---

## Next Steps

1. **[Weather Strategy Guide](./WEATHER_STRATEGY.md)** - Understanding the trading strategy
2. **[Deployment Guide](./DEPLOYMENT.md)** - Deploying to production
3. **[Risk Management](./RISK_MANAGEMENT.md)** - Understanding risk controls
