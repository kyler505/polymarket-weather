# Weather Trading Strategy Guide

This document explains the trading strategy used by the Weather Prediction Bot.

## Overview

The bot trades on Polymarket temperature prediction markets (e.g., "What will be the high temperature in NYC on January 20?"). These markets have multiple outcomes representing temperature ranges (bins), such as:

- "Below 30°F"
- "30-34°F"
- "35-39°F"
- "40-44°F"
- "45°F or higher"

---

## The Core Strategy

### Step 1: Fair Probability Calculation

For each temperature bin, we calculate the probability that the final temperature falls within that range using a **Normal distribution model**:

```
Fair Probability = P(lower_bound ≤ Temperature ≤ upper_bound)
```

Where:
- **Mean (μ)** = Forecast temperature from weather APIs
- **Standard Deviation (σ)** = Forecast uncertainty based on lead time

### Step 2: Sigma Calibration

Forecast accuracy decreases with lead time. We use calibrated sigma values:

| Lead Days | Sigma (°F) |
|-----------|------------|
| 0 (day-of) | 2.0 |
| 1 | 3.0 |
| 2 | 3.5 |
| 3 | 4.0 |
| 4 | 4.5 |
| 5 | 5.0 |
| 6 | 5.5 |
| 7 | 6.0 |

*These values are based on historical forecast error analysis.*

### Step 3: Edge Calculation

```
Edge = Fair Probability - Market Price
```

**Example:**
- Forecast: 42°F for NYC tomorrow
- Bin: "40-44°F"
- Fair Probability: 0.45 (45%)
- Market Price: 0.38 (38%)
- **Edge: +7%** ✅ (above 5% threshold)

### Step 4: Trade Signal

If edge exceeds threshold, generate BUY signal:
- Edge > +5%: Buy YES tokens (bin is underpriced)
- Edge < -5%: Sell YES tokens (bin is overpriced)

---

## Day-of Conditioning

On the day of resolution, we use a powerful technique called **max-so-far conditioning**:

### The Insight

If it's 2 PM and the high temperature so far is already 48°F, then:
- Any bin below 48°F is **impossible** (probability = 0)
- The remaining probability mass shifts to bins ≥ 48°F

### Implementation

1. Fetch current max temperature from weather APIs
2. Condition the Normal distribution: P(Temp | Temp ≥ max_so_far)
3. Recalculate bin probabilities

This creates significant edge opportunities when:
- Markets haven't updated to reflect current observations
- The max-so-far eliminates multiple low bins

---

## Position Sizing

### Kelly Criterion

We use a fractional Kelly criterion for position sizing:

```
Kelly Fraction = (Edge × Odds - (1 - Edge)) / Odds
```

Where:
- Edge = fair_probability - market_price
- Odds = (1 / market_price) - 1

**Example:**
- Fair probability: 0.45
- Market price: 0.38
- Edge: 0.07
- Odds: 1.63
- Kelly: (0.45 × 1.63 - 0.55) / 1.63 = 0.11 (11%)

We cap at 10% of capital per trade (fractional Kelly).

### Order Size Calculation

```
Order Size = min(Kelly% × Capital, MAX_ORDER_SIZE_USD)
Order Size = max(Order Size, MIN_ORDER_SIZE_USD)
```

---

## Ensemble Forecasting

We combine multiple forecast sources for robustness:

### NOAA/NWS
- Primary source for US locations
- Provides grid-based forecasts
- Higher accuracy for short-term

### Open-Meteo
- Global coverage
- Free API, no key required
- Good for verification

### Ensemble Process

1. Fetch forecasts from both sources
2. Average the high/low temperatures
3. Use larger sigma to account for model disagreement

---

## Hybrid ML Bias Correction (Optional)

To improve station-level accuracy, the bot can apply a lightweight ML bias-correction layer:

- Baseline: NOAA + Open-Meteo ensemble forecast
- ML layer: Ridge regression (MOS-style) + kNN analogs
- Blending: Weights are set by calibration RMSE

This hybrid approach preserves the physics-based forecast while correcting local biases and calibrating uncertainty.

---

## Risk Controls

### Per-Market Exposure

Limit risk on any single market:
```
if (current_exposure + trade_size > MAX_EXPOSURE_PER_MARKET) {
    skip_trade()
}
```

### Per-Region Exposure

Prevent concentration in one city:
```
if (region_exposure + trade_size > MAX_EXPOSURE_PER_REGION) {
    skip_trade()
}
```

### Per-Date Exposure

Limit same-day resolution risk:
```
if (date_exposure + trade_size > MAX_EXPOSURE_PER_DATE) {
    skip_trade()
}
```

### Daily Loss Limit

Auto-pause if losing too much:
```
if (daily_pnl < -MAX_DAILY_LOSS) {
    pause_trading("Daily loss limit")
}
```

---

## Supported Stations

The bot recognizes weather markets for these US airports:

| Station | City | Region |
|---------|------|--------|
| KLGA | New York (LaGuardia) | Northeast |
| KJFK | New York (JFK) | Northeast |
| KBOS | Boston | Northeast |
| KDCA | Washington DC | Northeast |
| KORD | Chicago | Midwest |
| KDTW | Detroit | Midwest |
| KMSP | Minneapolis | Midwest |
| KDFW | Dallas | South |
| KIAH | Houston | South |
| KMIA | Miami | South |
| KATL | Atlanta | South |
| KLAX | Los Angeles | West |
| KSFO | San Francisco | West |
| KSEA | Seattle | West |
| KDEN | Denver | West |

---

## Best Practices

### 1. Start with Dry Run
Always test with `WEATHER_DRY_RUN=true` first.

### 2. Conservative Edge Threshold
Start with 5-10% edge threshold instead of smaller values.

### 3. Monitor Day-of Markets
The best opportunities are on resolution day when max-so-far conditioning applies.

### 4. Watch Forecast Updates
Forecasts change - the bot refreshes regularly, but major forecast shifts create opportunities.

### 5. Backtest Sigma Values
The default sigma calibration is a starting point - adjust based on your analysis.

---

## Edge Cases

### Market Parsing Failures
Some markets may not parse correctly. The bot logs these as warnings and skips them.

### Station Not Found
If a market references an unsupported location, it's skipped.

### API Rate Limits
Weather APIs have rate limits. The bot caches forecasts to reduce calls.

### Thin Markets
Low liquidity markets may have high slippage. The bot respects `MAX_SLIPPAGE_PERCENT`.
