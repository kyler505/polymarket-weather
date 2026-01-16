# Weather ML Module

This module provides hybrid machine learning models for weather temperature prediction.

## Architecture

- **LSTM**: Long Short-Term Memory for capturing seasonal patterns
- **GRU**: Gated Recurrent Unit for short-term dependencies
- **RandomForest**: Feature-based ensemble for robust predictions
- **Meta-learner**: Ridge Regression to combine model outputs

## Setup

```bash
cd src/ml
pip install -r requirements.txt
```

## Training

```bash
python train.py --cities NYC,Chicago,LA --days 365
```

## Running the API Server

```bash
python api_server.py
```

The API will be available at `http://localhost:8765`

## API Endpoints

- `POST /predict` - Get ML-enhanced temperature prediction
- `GET /health` - Health check
