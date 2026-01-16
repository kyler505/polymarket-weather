# Task: Implement Hybrid ML Weather Prediction Model

## Objective
Refactor the weather bot to use a hybrid Python machine learning model for temperature predictions,
optimize the model to achieve positive PNL, and verify with multiple seed runs.

## Phases

### Phase 1: Research & Planning
- [x] Explore existing codebase structure
- [x] Research best ML models for weather/temperature prediction
- [x] Identify state-of-the-art: LSTM-GRU ensemble + Random Forest
- [/] Create implementation plan

### Phase 2: ML Model Implementation
- [ ] Create Python ML module structure (`src/ml/`)
- [ ] Implement data collection/preprocessing pipeline
  - [ ] Historical weather data fetcher (Open-Meteo Archive)
  - [ ] Feature engineering (lagged temps, seasonality, trends)
- [ ] Implement hybrid ensemble model
  - [ ] LSTM component for sequence patterns
  - [ ] GRU component for short-term dependencies
  - [ ] Random Forest for feature-based prediction
  - [ ] Meta-learner ensemble combiner
- [ ] Create model training script
- [ ] Save/load model weights

### Phase 3: Integration with Bot
- [ ] Create TypeScript-Python bridge (subprocess/HTTP API)
- [ ] Replace/augment probabilityEngine with ML predictions
- [ ] Update weatherDataService to use ML model
- [ ] Update forecastSimulator to support ML mode

### Phase 4: Training & Optimization
- [ ] Collect historical training data (2022-2025)
- [ ] Train model on NYC weather data
- [ ] Cross-validate on multiple cities
- [ ] Tune hyperparameters

### Phase 5: Backtesting & Verification
- [ ] Run multi-seed backtest (10+ seeds minimum)
- [ ] Compare ML model vs baseline Gaussian model
- [ ] Verify positive PNL across seeds
- [ ] Document results

### Phase 6: Production Configuration
- [ ] Generate optimal .env configuration
- [ ] Update documentation
- [ ] Final validation
