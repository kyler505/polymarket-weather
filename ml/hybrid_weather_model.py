#!/usr/bin/env python3
"""
Hybrid Weather ML Model
Combines baseline forecast with ML bias correction (ridge + kNN).
Pure-Python implementation (no external dependencies).
"""

import json
import math
import random
import sys
from typing import Any, Dict, List, Tuple


def _safe_float(value: Any) -> float:
    if value is None:
        return float("nan")
    try:
        return float(value)
    except Exception:
        return float("nan")


def _mean(values: List[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _std(values: List[float]) -> float:
    if len(values) < 2:
        return 0.0
    mu = _mean(values)
    var = sum((v - mu) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(var)


def _rmse(y_true: List[float], y_pred: List[float]) -> float:
    if not y_true:
        return 0.0
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(y_true, y_pred)) / len(y_true))


def _standardize(X: List[List[float]]) -> Tuple[List[List[float]], List[float], List[float]]:
    if not X:
        return X, [], []
    cols = len(X[0])
    means = []
    stds = []
    for j in range(cols):
        col = [row[j] for row in X]
        mu = _mean(col)
        sigma = _std(col)
        if sigma == 0:
            sigma = 1.0
        means.append(mu)
        stds.append(sigma)
    Xs = [[(row[j] - means[j]) / stds[j] for j in range(cols)] for row in X]
    return Xs, means, stds


def _apply_standardize(x: List[float], means: List[float], stds: List[float]) -> List[float]:
    return [(x[j] - means[j]) / stds[j] for j in range(len(x))]


def _transpose(matrix: List[List[float]]) -> List[List[float]]:
    return [list(row) for row in zip(*matrix)]


def _matmul(A: List[List[float]], B: List[List[float]]) -> List[List[float]]:
    result = []
    Bt = _transpose(B)
    for row in A:
        result.append([sum(a * b for a, b in zip(row, col)) for col in Bt])
    return result


def _matvec(A: List[List[float]], v: List[float]) -> List[float]:
    return [sum(a * b for a, b in zip(row, v)) for row in A]


def _gaussian_solve(A: List[List[float]], b: List[float]) -> List[float]:
    n = len(A)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for i in range(n):
        pivot = i
        for r in range(i + 1, n):
            if abs(M[r][i]) > abs(M[pivot][i]):
                pivot = r
        if abs(M[pivot][i]) < 1e-12:
            return [0.0] * n
        if pivot != i:
            M[i], M[pivot] = M[pivot], M[i]
        div = M[i][i]
        M[i] = [v / div for v in M[i]]
        for r in range(n):
            if r == i:
                continue
            factor = M[r][i]
            M[r] = [rv - factor * iv for rv, iv in zip(M[r], M[i])]
    return [row[-1] for row in M]


def _ridge_fit(X: List[List[float]], y: List[float], alpha: float) -> Dict[str, Any]:
    if not X:
        return {"weights": [], "bias": 0.0}
    Xs, means, stds = _standardize(X)
    Xb = [[1.0] + row for row in Xs]
    Xt = _transpose(Xb)
    XtX = _matmul(Xt, Xb)
    for i in range(len(XtX)):
        XtX[i][i] += alpha
    Xty = _matvec(Xt, y)
    coeffs = _gaussian_solve(XtX, Xty)
    bias = coeffs[0]
    weights = coeffs[1:]
    return {
        "weights": weights,
        "bias": bias,
        "means": means,
        "stds": stds
    }


def _ridge_predict(model: Dict[str, Any], x: List[float]) -> float:
    if not model.get("weights"):
        return float("nan")
    xs = _apply_standardize(x, model["means"], model["stds"])
    return model["bias"] + sum(w * xi for w, xi in zip(model["weights"], xs))


def _knn_predict(train_X: List[List[float]], train_y: List[float], x: List[float], k: int) -> float:
    if not train_X:
        return float("nan")
    distances = []
    for xi, yi in zip(train_X, train_y):
        d = math.sqrt(sum((a - b) ** 2 for a, b in zip(xi, x)))
        distances.append((d, yi))
    distances.sort(key=lambda t: t[0])
    k = max(1, min(k, len(distances)))
    neighbors = [val for _, val in distances[:k]]
    return _mean(neighbors)


def _calc_weights(y_true: List[float], base_pred: List[float], ridge_pred: List[float], knn_pred: List[float]) -> Dict[str, float]:
    rmse_base = _rmse(y_true, base_pred)
    rmse_ridge = _rmse(y_true, ridge_pred)
    rmse_knn = _rmse(y_true, knn_pred)
    rmse_base = rmse_base if rmse_base > 1e-6 else 1e-6
    rmse_ridge = rmse_ridge if rmse_ridge > 1e-6 else 1e-6
    rmse_knn = rmse_knn if rmse_knn > 1e-6 else 1e-6
    inv = [1 / rmse_base, 1 / rmse_ridge, 1 / rmse_knn]
    total = sum(inv)
    return {
        "baseline": inv[0] / total,
        "ridge": inv[1] / total,
        "knn": inv[2] / total
    }


def _split_data(data: List[Dict[str, Any]], split: float) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    if not data:
        return [], []
    data_copy = data[:]
    random.shuffle(data_copy)
    cut = max(1, int(len(data_copy) * (1 - split)))
    return data_copy[:cut], data_copy[cut:]


def _prepare_matrix(samples: List[Dict[str, Any]], feature_keys: List[str], target_key: str) -> Tuple[List[List[float]], List[float]]:
    X = []
    y = []
    for sample in samples:
        features = sample["features"]
        row = [_safe_float(features.get(k)) for k in feature_keys]
        if any(math.isnan(v) for v in row):
            continue
        target = _safe_float(sample.get(target_key))
        if math.isnan(target):
            continue
        X.append(row)
        y.append(target)
    return X, y


def _clip(value: float, baseline: float, clip_delta: float) -> float:
    lower = baseline - clip_delta
    upper = baseline + clip_delta
    return max(lower, min(upper, value))


def run_model(payload: Dict[str, Any]) -> Dict[str, Any]:
    config = payload.get("config", {})
    ridge_alpha = float(config.get("ridge_alpha", 1.0))
    knn_k = int(config.get("knn_k", 7))
    min_samples = int(config.get("min_samples", 25))
    calibration_split = float(config.get("calibration_split", 0.2))
    clip_delta = float(config.get("clip_delta", 12.0))
    sigma_floor = float(config.get("sigma_floor", 1.5))
    seed = int(config.get("seed", 42))
    random.seed(seed)

    training_data = payload.get("training_data", [])
    features = payload.get("features", {})

    feature_keys = payload.get("feature_keys", [])
    if not feature_keys:
        feature_keys = [
            "baseline_high",
            "baseline_low",
            "spread_high",
            "spread_low",
            "lead_days",
            "day_of_year_sin",
            "day_of_year_cos",
            "lat",
            "lon"
        ]

    if len(training_data) < min_samples:
        return {
            "forecast_high": features.get("baseline_high"),
            "forecast_low": features.get("baseline_low"),
            "sigma_high": config.get("sigma_fallback"),
            "sigma_low": config.get("sigma_fallback"),
            "model_info": {
                "status": "insufficient_training_data",
                "samples": len(training_data)
            }
        }

    train_set, calib_set = _split_data(training_data, calibration_split)
    if not calib_set:
        calib_set = train_set

    X_train, y_high_train = _prepare_matrix(train_set, feature_keys, "target_high")
    _, y_low_train = _prepare_matrix(train_set, feature_keys, "target_low")
    if not X_train or len(y_high_train) < min_samples:
        return {
            "forecast_high": features.get("baseline_high"),
            "forecast_low": features.get("baseline_low"),
            "sigma_high": config.get("sigma_fallback"),
            "sigma_low": config.get("sigma_fallback"),
            "model_info": {
                "status": "training_filtered",
                "samples": len(X_train)
            }
        }

    model_high = _ridge_fit(X_train, y_high_train, ridge_alpha)
    model_low = _ridge_fit(X_train, y_low_train, ridge_alpha)

    X_calib, y_high_calib = _prepare_matrix(calib_set, feature_keys, "target_high")
    _, y_low_calib = _prepare_matrix(calib_set, feature_keys, "target_low")

    X_calib_std = [_apply_standardize(x, model_high["means"], model_high["stds"]) for x in X_calib]

    baseline_high = [row[feature_keys.index("baseline_high")] for row in X_calib] if X_calib else []
    baseline_low = [row[feature_keys.index("baseline_low")] for row in X_calib] if X_calib else []

    ridge_high = [_ridge_predict(model_high, x) for x in X_calib]
    ridge_low = [_ridge_predict(model_low, x) for x in X_calib]

    knn_high = [_knn_predict(X_calib_std, y_high_calib, _apply_standardize(x, model_high["means"], model_high["stds"]), knn_k) for x in X_calib]
    knn_low = [_knn_predict(X_calib_std, y_low_calib, _apply_standardize(x, model_low["means"], model_low["stds"]), knn_k) for x in X_calib]

    weights_high = _calc_weights(y_high_calib, baseline_high, ridge_high, knn_high) if y_high_calib else {"baseline": 0.5, "ridge": 0.3, "knn": 0.2}
    weights_low = _calc_weights(y_low_calib, baseline_low, ridge_low, knn_low) if y_low_calib else {"baseline": 0.5, "ridge": 0.3, "knn": 0.2}

    x_current = [_safe_float(features.get(k)) for k in feature_keys]
    if any(math.isnan(v) for v in x_current):
        return {
            "forecast_high": features.get("baseline_high"),
            "forecast_low": features.get("baseline_low"),
            "sigma_high": config.get("sigma_fallback"),
            "sigma_low": config.get("sigma_fallback"),
            "model_info": {
                "status": "invalid_features"
            }
        }

    baseline_current_high = _safe_float(features.get("baseline_high"))
    baseline_current_low = _safe_float(features.get("baseline_low"))

    ridge_pred_high = _ridge_predict(model_high, x_current)
    ridge_pred_low = _ridge_predict(model_low, x_current)

    x_current_std_high = _apply_standardize(x_current, model_high["means"], model_high["stds"])
    x_current_std_low = _apply_standardize(x_current, model_low["means"], model_low["stds"])

    knn_pred_high = _knn_predict(X_calib_std, y_high_calib, x_current_std_high, knn_k) if X_calib_std else baseline_current_high
    knn_pred_low = _knn_predict(X_calib_std, y_low_calib, x_current_std_low, knn_k) if X_calib_std else baseline_current_low

    blended_high = (
        weights_high["baseline"] * baseline_current_high +
        weights_high["ridge"] * ridge_pred_high +
        weights_high["knn"] * knn_pred_high
    )
    blended_low = (
        weights_low["baseline"] * baseline_current_low +
        weights_low["ridge"] * ridge_pred_low +
        weights_low["knn"] * knn_pred_low
    )

    blended_high = _clip(blended_high, baseline_current_high, clip_delta)
    blended_low = _clip(blended_low, baseline_current_low, clip_delta)

    # Estimate sigma from calibration residuals
    ensemble_high = [
        weights_high["baseline"] * b +
        weights_high["ridge"] * r +
        weights_high["knn"] * k
        for b, r, k in zip(baseline_high, ridge_high, knn_high)
    ]
    ensemble_low = [
        weights_low["baseline"] * b +
        weights_low["ridge"] * r +
        weights_low["knn"] * k
        for b, r, k in zip(baseline_low, ridge_low, knn_low)
    ]

    residuals_high = [y - p for y, p in zip(y_high_calib, ensemble_high)]
    residuals_low = [y - p for y, p in zip(y_low_calib, ensemble_low)]
    sigma_high = max(_std(residuals_high), sigma_floor)
    sigma_low = max(_std(residuals_low), sigma_floor)

    return {
        "forecast_high": blended_high,
        "forecast_low": blended_low,
        "sigma_high": sigma_high,
        "sigma_low": sigma_low,
        "model_info": {
            "status": "ok",
            "samples": len(X_train),
            "weights_high": weights_high,
            "weights_low": weights_low,
            "ridge_alpha": ridge_alpha,
            "knn_k": knn_k
        }
    }


def main() -> None:
    raw = sys.stdin.read()
    if not raw:
        print(json.dumps({"error": "no_input"}))
        return
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        print(json.dumps({"error": "invalid_json"}))
        return

    result = run_model(payload)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
