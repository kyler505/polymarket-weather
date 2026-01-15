# Quick Start Guide

Get the Weather Bot running in under 5 minutes.

## Prerequisites

- Node.js 18+
- MongoDB database
- Polygon RPC endpoint
- Polymarket wallet with USDC

---

## Step 1: Install

```bash
git clone <repository-url>
cd polymarket-weather-bot
npm install
```

---

## Step 2: Configure

```bash
cp .env.example .env
```

Edit `.env` with minimum required settings:

```bash
PROXY_WALLET='0x...'
PRIVATE_KEY='...'
MONGO_URI='mongodb://...'
RPC_URL='https://polygon-mainnet.infura.io/v3/...'
```

---

## Step 3: Test Discovery

```bash
npm run discover
```

This will:
- Search Polymarket for weather markets
- Parse and display found markets
- Not place any trades

---

## Step 4: Run in Dry Mode

```bash
npm start
```

With default settings (`WEATHER_DRY_RUN=true`), the bot will:
- Discover weather markets
- Fetch weather forecasts
- Calculate probabilities
- Generate trade signals
- Log what trades it *would* make
- **Not place real trades**

---

## Step 5: Go Live

When ready for real trading, edit `.env`:

```bash
WEATHER_DRY_RUN=false
```

Then restart:

```bash
npm start
```

---

## What to Expect

### Console Output

```
🌤️ Weather Bot Started
ℹ Wallet: 0x65b9e5...
ℹ Discovering weather markets...
✓ Discovered 12 valid weather markets
ℹ Processing 5 markets within trading window
📊 Signal: BUY 40-44°F @ $0.35 (fair: $0.42, edge: 7.0%)
[DRY RUN] Would BUY 40-44°F @ $0.350 for $10.00
```

### Discord Notifications

If enabled, you'll receive:
- Startup notification
- Trade notifications
- Error alerts

---

## Common Issues

### "Cannot connect to MongoDB"
- Check `MONGO_URI` format
- Verify MongoDB is running
- Check IP whitelist (for Atlas)

### "No markets discovered"
- Polymarket may have no active weather markets
- Check Polymarket website directly

### "CLOB client error"
- Verify `PROXY_WALLET` is correct
- Check wallet has USDC
- Verify `PRIVATE_KEY` matches wallet

---

## Next Steps

- Read [GETTING_STARTED.md](./GETTING_STARTED.md) for full setup
- Read [WEATHER_STRATEGY.md](./WEATHER_STRATEGY.md) to understand the strategy
- Read [RISK_MANAGEMENT.md](./RISK_MANAGEMENT.md) before going live
