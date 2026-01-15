# Polymarket Weather Prediction Trading Bot

A specialized trading bot that discovers weather markets on Polymarket, computes fair probabilities using weather forecast data, and executes trades when edge exists.

## Features

- **Market Discovery**: Automatically discovers and parses temperature ladder markets on Polymarket
- **Multi-Source Forecasts**: Ingests weather data from NOAA/NWS and Open-Meteo APIs
- **Probability Engine**: Computes fair probabilities using calibrated Normal distribution models
- **Day-of Conditioning**: Updates probabilities based on observed max-so-far temperatures
- **Edge Trading**: Executes limit orders when market probability differs from fair value
- **Risk Management**: Per-market, per-region, and per-date exposure limits with kill-switches
- **Discord Integration**: Real-time monitoring and control via Discord commands

## How It Works

1. **Discovery**: Searches Polymarket for temperature prediction markets (e.g., "NYC high temperature on Jan 20")
2. **Parsing**: Extracts structured data: station ID, target date, temperature bins
3. **Forecasting**: Fetches ensemble forecasts from NOAA and Open-Meteo
4. **Probability Calculation**: Uses Normal distribution with day-specific sigma calibration
5. **Edge Detection**: Compares fair probability to market price, identifies trading opportunities
6. **Execution**: Places limit orders for bins with sufficient edge (configurable threshold)
7. **Risk Control**: Monitors exposure limits and daily P&L, auto-pauses if limits breached

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your settings

# Run in dry-run mode first (no real trades)
export WEATHER_DRY_RUN=true
npm start

# Discover weather markets without trading
npm run discover

# Test probability calculations
npm run test-probability
```

## Configuration

Key environment variables:

```bash
# Wallet Configuration
PROXY_WALLET=0x...your_wallet_address
PRIVATE_KEY=your_private_key

# Weather Trading Settings
WEATHER_EDGE_THRESHOLD=0.05          # 5% edge required to trade
WEATHER_MAX_LEAD_DAYS=7              # Only trade markets within 7 days
WEATHER_DRY_RUN=true                 # Set to false to execute real trades

# Risk Limits
MAX_EXPOSURE_PER_MARKET_USD=50       # Max $50 per market
MAX_EXPOSURE_PER_REGION_USD=200      # Max $200 per city/region
MAX_EXPOSURE_PER_DATE_USD=100        # Max $100 for same-date markets
MAX_DAILY_LOSS_USD=100               # Pause trading if daily loss exceeds $100

# Order Settings
MIN_ORDER_SIZE_USD=1                 # Minimum order size
MAX_ORDER_SIZE_USD=25                # Maximum order size
MAX_SLIPPAGE_PERCENT=3               # Maximum allowed slippage

# Stop-Loss / Take-Profit (optional)
STOP_LOSS_ENABLED=true
STOP_LOSS_PERCENT=25
TAKE_PROFIT_ENABLED=true
TAKE_PROFIT_PERCENT=50
```

## Discord Commands

If Discord bot is enabled:

| Command | Description |
|---------|-------------|
| `/stats` | Portfolio overview: balance, positions, P&L |
| `/positions` | List open positions with pagination |
| `/markets` | Show tracked weather markets |
| `/exposure` | Current exposure by region/date |
| `/config` | Display bot configuration |
| `/pause` | Pause trading |
| `/resume` | Resume trading |
| `/status` | Health check and uptime |

## Supported Stations

The bot supports 15 major US airports:

- **Northeast**: KLGA (NYC), KJFK (NYC), KBOS (Boston), KDCA (DC)
- **Midwest**: KORD (Chicago), KDTW (Detroit), KMSP (Minneapolis)
- **South**: KDFW (Dallas), KIAH (Houston), KMIA (Miami), KATL (Atlanta)
- **West**: KLAX (Los Angeles), KSFO (San Francisco), KSEA (Seattle), KDEN (Denver)

## Architecture

```
src/
├── config/
│   ├── env.ts                    # Environment configuration
│   └── weatherConfig.ts          # Station mappings, sigma calibration
├── interfaces/
│   └── WeatherMarket.ts          # TypeScript interfaces
├── models/
│   ├── weatherMarket.ts          # MongoDB schema
│   └── botPositions.ts           # Position tracking
├── services/
│   ├── weatherMarketDiscovery.ts # Polymarket API search
│   ├── weatherMarketParser.ts    # Title/rules parsing
│   ├── weatherDataService.ts     # NOAA/Open-Meteo API
│   ├── probabilityEngine.ts      # Fair probability calculation
│   ├── weatherMonitor.ts         # Main monitoring loop
│   ├── weatherExecutor.ts        # Order execution
│   ├── weatherRiskManager.ts     # Exposure & kill-switches
│   └── discordBot.ts             # Discord slash commands
└── index.ts                      # Entry point
```

## Safety Features

- **Dry Run Mode**: Test without executing real trades
- **Exposure Limits**: Per-market, per-region, per-date caps
- **Daily Loss Limit**: Auto-pause if losses exceed threshold
- **Data Freshness**: Kill-switch if weather data becomes stale
- **Slippage Protection**: Skip trades with excessive slippage

## Development

```bash
# Build TypeScript
npm run build

# Run with hot reload
npm run dev

# Type check
npm run typecheck
```

## License

MIT
