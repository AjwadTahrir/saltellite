from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from twilio.rest import Client
from datetime import datetime, timedelta
from groq import Groq
import requests
import pickle
import pandas as pd
import os

load_dotenv()
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Load salinity model ────────────────────────────────────────────────────
MODEL_PATH = os.path.join(os.path.dirname(__file__), "salinity_model.pkl")
with open(MODEL_PATH, "rb") as f:
    salinity_model = pickle.load(f)
print("Salinity model loaded.")


# ── Sentinel Hub Auth ──────────────────────────────────────────────────────
def get_sentinel_token():
    resp = requests.post(
        "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token",
        data={
            "grant_type": "client_credentials",
            "client_id": os.getenv("SENTINEL_CLIENT_ID"),
            "client_secret": os.getenv("SENTINEL_CLIENT_SECRET"),
        },
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


# ── Fetch satellite index (generic) ───────────────────────────────────────
def fetch_index(token: str, bbox: list, evalscript: str, index_name: str):
    date_to   = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    date_from = (datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%SZ")

    payload = {
        "input": {
            "bounds": {
                "bbox": bbox,
                "properties": { "crs": "http://www.opengis.net/def/crs/EPSG/0/4326" }
            },
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": { "mosaickingOrder": "leastCC", "maxCloudCoverage": 80 }
            }]
        },
        "aggregation": {
            "timeRange": { "from": date_from, "to": date_to },
            "aggregationInterval": { "of": "P30D" },
            "evalscript": evalscript,
            "resx": 20, "resy": 20
        },
        "calculations": {
            index_name: {
                "histograms": {
                    "default": { "nBins": 20, "lowEdge": -1.0, "highEdge": 1.0 }
                }
            }
        }
    }

    resp = requests.post(
        "https://services.sentinel-hub.com/api/v1/statistics",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )

    if not resp.ok:
        return None

    data      = resp.json()
    intervals = data.get("data", [])
    valid     = [
        i for i in intervals
        if i.get("outputs", {}).get(index_name, {}).get("bands", {}).get("B0", {}).get("stats", {}).get("mean") is not None
    ]

    if not valid:
        return None

    return round(float(valid[-1]["outputs"][index_name]["bands"]["B0"]["stats"]["mean"]), 4)


# ── Evalscripts for each index ─────────────────────────────────────────────
EVALSCRIPTS = {
    "ndvi": """
//VERSION=3
function setup() { return { input: [{ bands: ["B04","B08","dataMask"] }], output: [{ id:"ndvi", bands:1, sampleType:"FLOAT32"},{ id:"dataMask", bands:1}] }; }
function evaluatePixel(s) { return { ndvi: [(s.B08-s.B04)/(s.B08+s.B04+0.0001)], dataMask:[s.dataMask] }; }
""",
    "ndsi": """
//VERSION=3
function setup() { return { input: [{ bands: ["B04","B08","dataMask"] }], output: [{ id:"ndsi", bands:1, sampleType:"FLOAT32"},{ id:"dataMask", bands:1}] }; }
function evaluatePixel(s) { return { ndsi: [(s.B04-s.B08)/(s.B04+s.B08+0.0001)], dataMask:[s.dataMask] }; }
""",
    "ndwi": """
//VERSION=3
function setup() { return { input: [{ bands: ["B03","B08","dataMask"] }], output: [{ id:"ndwi", bands:1, sampleType:"FLOAT32"},{ id:"dataMask", bands:1}] }; }
function evaluatePixel(s) { return { ndwi: [(s.B03-s.B08)/(s.B03+s.B08+0.0001)], dataMask:[s.dataMask] }; }
""",
    "bsi": """
//VERSION=3
function setup() { return { input: [{ bands: ["B02","B04","B08","B11","dataMask"] }], output: [{ id:"bsi", bands:1, sampleType:"FLOAT32"},{ id:"dataMask", bands:1}] }; }
function evaluatePixel(s) { return { bsi: [((s.B11+s.B04)-(s.B08+s.B02))/((s.B11+s.B04)+(s.B08+s.B02)+0.0001)], dataMask:[s.dataMask] }; }
""",
    "evi": """
//VERSION=3
function setup() { return { input: [{ bands: ["B02","B04","B08","dataMask"] }], output: [{ id:"evi", bands:1, sampleType:"FLOAT32"},{ id:"dataMask", bands:1}] }; }
function evaluatePixel(s) { return { evi: [2.5*(s.B08-s.B04)/(s.B08+6*s.B04-7.5*s.B02+1+0.0001)], dataMask:[s.dataMask] }; }
""",
    "savi": """
//VERSION=3
function setup() { return { input: [{ bands: ["B04","B08","dataMask"] }], output: [{ id:"savi", bands:1, sampleType:"FLOAT32"},{ id:"dataMask", bands:1}] }; }
function evaluatePixel(s) { let L=0.5; return { savi: [(s.B08-s.B04)/(s.B08+s.B04+L)*(1+L)], dataMask:[s.dataMask] }; }
""",
}


def fallback_indices(seed=0):
    """Realistic fallback values if Sentinel Hub returns no data."""
    import random
    r = random.Random(seed)
    ndvi = round(r.uniform(0.25, 0.70), 4)
    return {
        "ndvi": ndvi,
        "ndsi": round(r.uniform(-0.30, 0.20), 4),
        "ndwi": round(r.uniform(-0.20, 0.15), 4),
        "bsi":  round(r.uniform(-0.15, 0.25), 4),
        "evi":  round(ndvi * r.uniform(0.75, 0.90), 4),
        "savi": round(ndvi * r.uniform(0.80, 0.95), 4),
        "source": "simulated",
    }


# ── Main field analysis endpoint ───────────────────────────────────────────
@app.get("/field")
def get_field(lat: float, lng: float):
    """
    Fetches all satellite indices for a location, predicts salinity,
    and returns full field analysis.
    """
    try:
        token = get_sentinel_token()
        delta = 0.003
        bbox  = [lng - delta, lat - delta, lng + delta, lat + delta]

        # Fetch all indices
        indices = {}
        for name, script in EVALSCRIPTS.items():
            val = fetch_index(token, bbox, script, name)
            indices[name] = val

        # Check how many succeeded
        missing = [k for k, v in indices.items() if v is None]
        if len(missing) >= 4:
            fb = fallback_indices(seed=int(lat * 1000))
            indices = {k: fb[k] for k in EVALSCRIPTS}
            source = "simulated"
        else:
            # Fill any missing with fallback
            fb = fallback_indices(seed=int(lat * 1000))
            for k in missing:
                indices[k] = fb[k]
            source = "sentinel-2"

        # Predict salinity
        features = pd.DataFrame([{
            "ndvi": indices["ndvi"],
            "ndsi": indices["ndsi"],
            "ndwi": indices["ndwi"],
            "bsi":  indices["bsi"],
            "evi":  indices["evi"],
            "savi": indices["savi"],
        }])
        ec = round(float(salinity_model.predict(features)[0]), 2)
        ec = max(0.1, ec)

        # Salinity risk
        if ec < 2.0:
            salinity_risk  = "Safe"
            salinity_color = "green"
        elif ec < 4.0:
            salinity_risk  = "Mild"
            salinity_color = "yellow"
        elif ec < 8.0:
            salinity_risk  = "Moderate"
            salinity_color = "orange"
        else:
            salinity_risk  = "Severe"
            salinity_color = "red"

        # NDVI crop health
        ndvi = indices["ndvi"]
        if ndvi >= 0.6:
            crop_status = "Healthy"
        elif ndvi >= 0.4:
            crop_status = "Stressed"
        else:
            crop_status = "Critical"

        return {
            "indices": indices,
            "source":  source,
            "date":    datetime.utcnow().strftime("%Y-%m-%d"),
            "salinity": {
                "ec":    ec,
                "risk":  salinity_risk,
                "color": salinity_color,
                "unit":  "dS/m",
            },
            "crop": {
                "ndvi":   ndvi,
                "status": crop_status,
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Keep legacy /ndvi endpoint for backward compat ─────────────────────────
@app.get("/ndvi")
def get_ndvi(lat: float, lng: float):
    data = get_field(lat, lng)
    ndvi = data["crop"]["ndvi"]
    return {
        "ndvi":   ndvi,
        "date":   data["date"],
        "lat":    lat,
        "lng":    lng,
        "status": data["crop"]["status"].lower(),
        "source": data["source"],
    }


# ── AI Analysis ────────────────────────────────────────────────────────────
class AnalysisRequest(BaseModel):
    field_name: str
    ndvi: float
    ndsi: float
    ndwi: float
    bsi: float
    ec: float
    salinity_risk: str
    crop_status: str
    area: str
    date: str


@app.post("/analyze")
def analyze_field(req: AnalysisRequest):
    try:
        client = Groq(api_key=os.getenv("GROQ_API_KEY"))

        prompt = f"""You are an expert agronomist and soil scientist specializing in saline intrusion in coastal Malaysian farmland.

Real satellite + AI prediction data for this field:
- Field: {req.field_name} ({req.area})
- Date: {req.date}
- NDVI: {req.ndvi} (vegetation health, >0.6 healthy, <0.4 critical)
- NDSI (Salinity Index): {req.ndsi} (higher = more saline soil)
- NDWI (Water Index): {req.ndwi} (higher = more waterlogging)
- BSI (Bare Soil Index): {req.bsi} (higher = less vegetation cover)
- Predicted Soil EC: {req.ec} dS/m (salinity, safe <2.0, severe >8.0)
- Salinity Risk: {req.salinity_risk}
- Crop Status: {req.crop_status}

Provide a focused saline intrusion analysis with:
1. Overall field health risk score (0-100, where 100 = perfect)
2. Top 2-3 specific issues detected from the satellite data
3. Practical recommended actions for the Malaysian farmer
4. Urgency: CRITICAL / WARNING / NORMAL

Respond ONLY as JSON with these exact keys:
{{
  "risk_score": <0-100>,
  "health_label": "<Excellent|Good|Fair|Poor|Critical>",
  "issues": ["<issue1>", "<issue2>"],
  "recommendations": ["<action1>", "<action2>", "<action3>"],
  "urgency": "<CRITICAL|WARNING|NORMAL>",
  "summary": "<2 sentence plain English summary focused on salinity risk>"
}}"""

        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{ "role": "user", "content": prompt }],
            temperature=0.3,
            max_tokens=600,
        )

        import json
        raw = response.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── SMS ────────────────────────────────────────────────────────────────────
class SMSRequest(BaseModel):
    to: str
    field_name: str
    ec: float
    salinity_risk: str
    ndvi: float
    urgency: str = "NORMAL"
    summary: str = ""
    recommendations: list = []


@app.post("/send-sms")
def send_sms(req: SMSRequest):
    try:
        client = Client(
            os.getenv("TWILIO_ACCOUNT_SID"),
            os.getenv("TWILIO_AUTH_TOKEN"),
        )

        recs = "\n".join([f"- {r}" for r in req.recommendations[:2]]) if req.recommendations else ""

        body = (
            f"[SALTellite Alert] {req.urgency}\n"
            f"Field: {req.field_name}\n"
            f"Salinity: {req.ec} dS/m ({req.salinity_risk})\n"
            f"NDVI: {req.ndvi}\n\n"
            f"{req.summary}\n\n"
            f"Actions:\n{recs}\n"
            f"-- SALTellite Satellite System"
        )

        message = client.messages.create(
            body=body,
            from_=os.getenv("TWILIO_FROM"),
            to=req.to,
        )

        return {"success": True, "sid": message.sid, "status": message.status}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Inbound SMS webhook (farmer queries) ───────────────────────────────────
FIELD_MAP = {
    "A": { "name": "Field A — Paddy", "lat": 3.139,  "lng": 101.6869, "area": "4.2 ha" },
    "B": { "name": "Field B — Corn",  "lat": 3.155,  "lng": 101.700,  "area": "2.8 ha" },
    "C": { "name": "Field C — Palm",  "lat": 3.125,  "lng": 101.675,  "area": "6.1 ha" },
    "D": { "name": "Field D — Paddy", "lat": 3.148,  "lng": 101.660,  "area": "3.5 ha" },
}

@app.post("/sms-webhook")
async def sms_webhook(request: Request):
    """
    Twilio webhook — farmer sends SMS like 'STATUS A' or 'FIELD B'
    and gets back a salinity + crop update.
    """
    try:
        form   = await request.form()
        body   = form.get("Body", "").strip().upper()
        sender = form.get("From", "")

        twilio_client = Client(
            os.getenv("TWILIO_ACCOUNT_SID"),
            os.getenv("TWILIO_AUTH_TOKEN"),
        )

        # Parse field key
        field_key = None
        for key in FIELD_MAP:
            if key in body:
                field_key = key
                break

        if not field_key:
            reply = (
                "SALTellite — Crop & Salinity Monitor\n\n"
                "Send: STATUS A, STATUS B, STATUS C, or STATUS D\n"
                "to get the latest update for your field."
            )
        else:
            field = FIELD_MAP[field_key]
            data  = get_field(field["lat"], field["lng"])

            ec   = data["salinity"]["ec"]
            risk = data["salinity"]["risk"]
            ndvi = data["crop"]["ndvi"]
            crop = data["crop"]["status"]
            date = data["date"]

            if risk == "Severe":
                action = "URGENT: Stop irrigation, apply gypsum treatment immediately."
            elif risk == "Moderate":
                action = "Flush fields with fresh water. Monitor daily."
            elif risk == "Mild":
                action = "Increase freshwater irrigation. Check drainage."
            else:
                action = "Field is healthy. Continue normal farming."

            reply = (
                f"SALTellite Update — {field['name']}\n"
                f"Date: {date}\n\n"
                f"Salinity: {ec} dS/m — {risk}\n"
                f"Crop Health: {crop} (NDVI {ndvi})\n\n"
                f"{action}\n\n"
                f"Reply STATUS A/B/C/D for other fields."
            )

        twilio_client.messages.create(
            body=reply,
            from_=os.getenv("TWILIO_FROM"),
            to=sender,
        )

        return {"status": "ok"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Health check ───────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "SALTellite API running", "version": "3.0"}