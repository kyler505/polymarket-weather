# Funding Your Wallet

This guide explains how to fund your Polymarket wallet with USDC for weather trading.

## Understanding Polymarket Wallets

Polymarket uses **proxy wallets** on Polygon. Your proxy wallet is a smart contract controlled by your EOA (externally owned account).

**Important**: You need to fund your **proxy wallet**, not your EOA.

---

## Step 1: Get Your Proxy Wallet Address

Your proxy wallet address is in your `.env`:

```bash
PROXY_WALLET='0x...'
```

This is the address that needs USDC.

---

## Step 2: Get USDC on Polygon

### Option A: Bridge from Ethereum

1. Go to [Polygon Bridge](https://wallet.polygon.technology/bridge)
2. Connect your wallet
3. Select USDC
4. Bridge from Ethereum to Polygon

### Option B: Buy on Exchange

1. Buy USDC on Coinbase, Binance, etc.
2. Withdraw to Polygon network
3. Send to your proxy wallet address

### Option C: Swap on Polygon

1. Get MATIC on Polygon
2. Use [Uniswap](https://app.uniswap.org) or [QuickSwap](https://quickswap.exchange)
3. Swap MATIC for USDC
4. Send USDC to proxy wallet

---

## Step 3: Verify Balance

Check your balance on [Polygonscan](https://polygonscan.com):

```
https://polygonscan.com/address/YOUR_PROXY_WALLET
```

Look for USDC (PoS) token balance.

---

## Step 4: Approve USDC Spending

The bot needs permission to spend USDC. Run:

```bash
npm run check-allowance
```

If allowance is insufficient, approve more:

```bash
npm run approve-usdc
```

---

## Recommended Amounts

| Experience Level | Recommended Amount |
|-----------------|-------------------|
| Testing | $25-50 |
| Small | $100-250 |
| Medium | $500-1000 |
| Large | $2000+ |

**Tip**: Start small while learning the bot's behavior.

---

## USDC Contract Address

The bot uses **USDC.e (Bridged USDC)** on Polygon:

```
0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
```

Make sure you're sending this token, not native USDC or other variants.

---

## Gas (MATIC)

Your proxy wallet also needs a small amount of MATIC for gas:

- Recommended: 0.1-0.5 MATIC
- Get from exchange or [faucets](https://faucet.polygon.technology)

The bot uses minimal gas for order signing.

---

## Security Reminders

1. **Never share your private key**
2. **Use a dedicated wallet** for the bot
3. **Only fund what you're willing to lose**
4. **Start with small amounts**
5. **Monitor the bot regularly**

---

## Troubleshooting

### "Insufficient balance" errors

- Check proxy wallet has USDC (not your EOA)
- Verify you sent to correct address
- Check token is USDC.e on Polygon

### "Insufficient allowance" errors

```bash
npm run approve-usdc
```

### Transaction stuck

- Increase gas price
- Wait for network congestion to clear
- Check [Polygon Gas Tracker](https://polygonscan.com/gastracker)
