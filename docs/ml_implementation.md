# Hybrid ML Forecast Implementation

## Overview
The bot can optionally call a Python-based hybrid ML model that performs bias correction on top of the NOAA + Open-Meteo ensemble. The model is lightweight (pure Python, no external dependencies) and returns both a corrected forecast and uncertainty estimates.

## How it works
1. **Forecast sources**: NOAA + Open-Meteo are fetched and combined into a baseline ensemble.  
2. **Training data**: Historical daily actuals are collected. If historical forecasts are available, they are used; otherwise training can be skipped or simulated (disabled by default).  
3. **Hybrid ML**: A ridge regression and kNN regression are trained on the historical data.  
4. **Blend + uncertainty**: The baseline, ridge, and kNN predictions are blended with weights based on calibration RMSE. The residuals define sigma.

## Files
- `ml/hybrid_weather_model.py` — Python ML model runner
- `src/utils/hybridModel.ts` — Node bridge for running Python model
- `src/services/weatherDataService.ts` — Hybrid forecast builder
- `src/services/weatherMonitor.ts` — Enables hybrid mode in live trading

## Configuration
Enable in `.env`:

- `WEATHER_ML_ENABLED=true`
- `WEATHER_ML_LOOKBACK_DAYS=60`
- `WEATHER_ML_MIN_SAMPLES=25`
- `WEATHER_ML_PYTHON_PATH=python3`

Optional tuning:
- `WEATHER_ML_RIDGE_ALPHA`
- `WEATHER_ML_KNN_K`
- `WEATHER_ML_CALIBRATION_SPLIT`
- `WEATHER_ML_CLIP_DELTA`
- `WEATHER_ML_SIGMA_FLOOR`
- `WEATHER_ML_ALLOW_SIMULATED_TRAINING` (default false)

## Notes
- If training data is insufficient, the bot falls back to the ensemble forecast.  
- The ML model runs per station/date and is cached to reduce overhead.  
