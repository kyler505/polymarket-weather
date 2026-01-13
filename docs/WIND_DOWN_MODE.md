# Wind Down Mode - Implementation Complete

## Summary

Added a "Wind Down Mode" feature for safe wallet migration. When enabled, the bot stops opening new positions but continues to close existing ones.

## Changes Made

| File | Change |
|------|--------|
| [env.ts](file:///Users/kcao/Documents/polymarket-copy-trading-bot/src/config/env.ts) | Added `WIND_DOWN_MODE` and `TARGET_WALLET` config vars |
| [.env.example](file:///Users/kcao/Documents/polymarket-copy-trading-bot/.env.example) | Added documentation section for wind-down mode |
| [postOrder.ts](file:///Users/kcao/Documents/polymarket-copy-trading-bot/src/utils/postOrder.ts) | Added early return in BUY block when wind-down active |
| [migrateWallet.ts](file:///Users/kcao/Documents/polymarket-copy-trading-bot/src/scripts/migrateWallet.ts) | **[NEW]** Migration script with position check + USDC transfer |
| [package.json](file:///Users/kcao/Documents/polymarket-copy-trading-bot/package.json) | Added `migrate-wallet` npm script |

## How to Use

### Step 1: Enable Wind Down Mode
Add to your `.env`:
```bash
WIND_DOWN_MODE = true
TARGET_WALLET = '0xYourNewPolymarketProxyAddress'
```

### Step 2: Restart the Bot
```bash
npm run dev
```
The bot will now:
- ✅ Continue monitoring traders
- ✅ Execute SELL orders normally
- ❌ Skip all BUY orders (logged as "WIND DOWN MODE: Skipping BUY")

### Step 3: Wait for Positions to Close
Check periodically via Polymarket UI or wait for traders to sell.

### Step 4: Migrate Funds
Once all positions are closed:
```bash
npm run migrate-wallet
```
This will:
1. Verify no open positions remain
2. Show your USDC balance
3. Prompt for confirmation (type "MIGRATE")
4. Transfer USDC to `TARGET_WALLET`

### Step 5: Update Config
After migration:
1. Change `PROXY_WALLET` to your new address
2. Set `WIND_DOWN_MODE = false`
3. Restart the bot

## Verification

- ✅ TypeScript compiles without errors
