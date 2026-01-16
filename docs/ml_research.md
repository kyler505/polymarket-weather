# Hybrid ML Weather Research Notes

## Executive summary
Weather forecasting is dominated by numerical weather prediction (NWP) models, while modern ML is strongest as a post-processing layer (bias correction, uncertainty calibration, and local downscaling). The most robust approach for a trading bot with limited feature access is a hybrid ensemble: combine multiple NWP sources and apply ML bias correction to improve station-level accuracy and uncertainty estimates.

## What generally works best in practice
1. **NWP ensemble baselines**  
   - Multi-model ensembles (e.g., GFS, ECMWF, ICON) outperform any single model due to error diversification.  
   - Blending across providers and time horizons is the standard baseline for temperature forecasting.
2. **MOS / bias-correction models**  
   - Model Output Statistics (MOS) uses regression to correct systematic biases by station and lead time.  
   - MOS-style models are straightforward, stable, and strong at station-level improvements.
3. **Modern ML for local post-processing**  
   - Gradient boosting (XGBoost/LightGBM), random forests, and kNN are common for near-term temperature bias correction.  
   - These models perform well with limited features (forecast temperature, lead time, and seasonality).
4. **Deep learning for global fields**  
   - Large-scale models (e.g., GraphCast, FourCastNet, Pangu-Weather) excel at global fields but require extensive compute and are not feasible to host in a trading bot runtime.

## Key trade-offs for this bot
- **Feature availability**: We have limited access to high-dimensional model fields (wind, pressure, humidity).  
- **Latency & cost**: The model must run locally and be lightweight.  
- **Robustness**: We need consistent, repeatable improvements without overfitting.

## Chosen hybrid approach
The bot now uses a **hybrid ensemble**:
1. **Baseline**: NOAA + Open-Meteo ensemble (simple average + spread-based uncertainty bump).
2. **ML bias correction**:  
   - Ridge regression (MOS-like) to learn linear bias correction.  
   - kNN regression to capture local analog days (nonlinear correction).
3. **Adaptive weighting**: The ensemble weights for baseline/ridge/kNN are inversely proportional to RMSE on a calibration split.

This hybrid design keeps the physics-driven forecast as the backbone while letting ML correct local bias and improve uncertainty. It balances performance, stability, and runtime simplicity.

## Validation plan
- **Backtests**: Multi-seed simulations over multiple days, with market spread + vig.  
- **Metrics**: PnL, win rate, max drawdown, Brier score.  
- **Success criteria**: Positive median PnL and acceptable drawdown across seeds.

## Known limitations
- Historical forecast availability can be limited on public APIs; simulated training data is optional but disabled by default.  
- This is a lightweight bias-correction model, not a full weather prediction engine.
