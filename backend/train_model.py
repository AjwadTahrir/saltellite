"""
SALTellite — Salinity Prediction Model Training
Trains a model to predict soil EC (salinity) from satellite indices.
Based on known spectral-salinity relationships in coastal farmland.
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.pipeline import Pipeline
import pickle
import os

np.random.seed(42)
N = 2000  # synthetic samples

# ── Generate synthetic training data ──────────────────────────────────────
# EC (electrical conductivity) in dS/m:
# < 2.0  = safe for most crops
# 2.0–4.0 = mild stress
# 4.0–8.0 = moderate stress (significant yield loss)
# > 8.0  = severe stress (most crops fail)

ec = np.random.exponential(scale=3.0, size=N).clip(0.2, 15.0)

# NDVI: healthy vegetation absorbs red, reflects NIR
# High salinity → damaged vegetation → low NDVI
ndvi_base = 0.75 - (ec * 0.045) + np.random.normal(0, 0.06, N)
ndvi = ndvi_base.clip(-0.1, 0.9)

# NDSI (Salinity Index = (Red - NIR) / (Red + NIR))
# Higher salinity → less vegetation → higher NDSI
ndsi_base = -0.30 + (ec * 0.055) + np.random.normal(0, 0.05, N)
ndsi = ndsi_base.clip(-0.6, 0.6)

# NDWI (Water Index = (Green - NIR) / (Green + NIR))
# Saline intrusion increases soil moisture → higher NDWI
ndwi_base = -0.20 + (ec * 0.025) + np.random.normal(0, 0.05, N)
ndwi = ndwi_base.clip(-0.5, 0.4)

# BSI (Bare Soil Index)
# High salinity kills vegetation → more bare soil → higher BSI
bsi_base = -0.15 + (ec * 0.035) + np.random.normal(0, 0.04, N)
bsi = bsi_base.clip(-0.4, 0.5)

# EVI (Enhanced Vegetation Index) — more sensitive than NDVI in dense veg
evi_base = 0.60 - (ec * 0.040) + np.random.normal(0, 0.05, N)
evi = evi_base.clip(-0.1, 0.8)

# SAVI (Soil-Adjusted Vegetation Index)
savi_base = 0.65 - (ec * 0.042) + np.random.normal(0, 0.05, N)
savi = savi_base.clip(-0.1, 0.85)

# Build dataframe
df = pd.DataFrame({
    "ndvi": ndvi,
    "ndsi": ndsi,
    "ndwi": ndwi,
    "bsi":  bsi,
    "evi":  evi,
    "savi": savi,
    "ec":   ec,
})

print(f"Training data: {len(df)} samples")
print(f"EC range: {df['ec'].min():.2f} – {df['ec'].max():.2f} dS/m")
print(f"EC mean:  {df['ec'].mean():.2f} dS/m\n")

# ── Train model ────────────────────────────────────────────────────────────
X = df[["ndvi", "ndsi", "ndwi", "bsi", "evi", "savi"]]
y = df["ec"]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Use Gradient Boosting — best for this type of regression
model = Pipeline([
    ("scaler", StandardScaler()),
    ("regressor", GradientBoostingRegressor(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.08,
        subsample=0.85,
        random_state=42,
    ))
])

model.fit(X_train, y_train)

# ── Evaluate ───────────────────────────────────────────────────────────────
y_pred = model.predict(X_test)
mae    = mean_absolute_error(y_test, y_pred)
r2     = r2_score(y_test, y_pred)
cv     = cross_val_score(model, X, y, cv=5, scoring="r2")

print("── Model Performance ──────────────────────")
print(f"MAE:              {mae:.3f} dS/m")
print(f"R² Score:         {r2:.3f}")
print(f"Cross-val R²:     {cv.mean():.3f} ± {cv.std():.3f}")
print()

# Feature importance
importances = model.named_steps["regressor"].feature_importances_
features    = X.columns
print("── Feature Importance ─────────────────────")
for f, imp in sorted(zip(features, importances), key=lambda x: -x[1]):
    print(f"  {f:6s}: {imp:.3f}")
print()

# ── Save model ─────────────────────────────────────────────────────────────
model_path = os.path.join(os.path.dirname(__file__), "salinity_model.pkl")
with open(model_path, "wb") as f:
    pickle.dump(model, f)

print(f"Model saved to: {model_path}")
print()

# ── Quick sanity check ─────────────────────────────────────────────────────
print("── Sanity Check ───────────────────────────")
test_cases = [
    {"label": "Healthy field",       "ndvi": 0.75, "ndsi": -0.25, "ndwi": -0.15, "bsi": -0.10, "evi": 0.60, "savi": 0.62},
    {"label": "Mild saline stress",  "ndvi": 0.50, "ndsi": -0.05, "ndwi": 0.00,  "bsi": 0.05,  "evi": 0.38, "savi": 0.40},
    {"label": "Moderate salinity",   "ndvi": 0.30, "ndsi": 0.15,  "ndwi": 0.10,  "bsi": 0.18,  "evi": 0.22, "savi": 0.24},
    {"label": "Severe saline",       "ndvi": 0.10, "ndsi": 0.35,  "ndwi": 0.20,  "bsi": 0.30,  "evi": 0.08, "savi": 0.10},
]

for tc in test_cases:
    label = tc.pop("label")
    pred  = model.predict(pd.DataFrame([tc]))[0]
    risk  = "Safe" if pred < 2 else "Mild" if pred < 4 else "Moderate" if pred < 8 else "Severe"
    print(f"  {label:25s}: {pred:.2f} dS/m ({risk})")
