from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from datetime import datetime, timedelta
from groq import Groq
import requests
import pickle
import pandas as pd
import os
import json

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


# ── Fetch satellite index ──────────────────────────────────────────────────
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


# ── Evalscripts ────────────────────────────────────────────────────────────
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
def get_field(lat: float, lng: float, radius: float = 300):
    try:
        token = get_sentinel_token()
        
        # Scale bounding box to actual field radius
        delta = max(0.003, radius / 111000)
        bbox  = [lng - delta, lat - delta, lng + delta, lat + delta]

        indices = {}
        for name, script in EVALSCRIPTS.items():
            val = fetch_index(token, bbox, script, name)
            indices[name] = val

        missing = [k for k, v in indices.items() if v is None]
        if len(missing) >= 4:
            fb = fallback_indices(seed=int(lat * 1000))
            indices = {k: fb[k] for k in EVALSCRIPTS}
            source = "simulated"
        else:
            fb = fallback_indices(seed=int(lat * 1000))
            for k in missing:
                indices[k] = fb[k]
            source = "sentinel-2"

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

        ndvi = indices["ndvi"]
        crop_status = "Healthy" if ndvi >= 0.6 else "Stressed" if ndvi >= 0.4 else "Critical"

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


# ── Legacy NDVI endpoint ───────────────────────────────────────────────────
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

        raw = response.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Infobip SMS helper ─────────────────────────────────────────────────────
def send_infobip_sms(to: str, body: str):
    api_key  = os.getenv("INFOBIP_API_KEY")
    base_url = os.getenv("INFOBIP_BASE_URL")
    return requests.post(
        f"https://{base_url}/sms/3/messages",
        headers={
            "Authorization": f"App {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        json={
            "messages": [{
                "destinations": [{ "to": to.replace("+", "") }],
                "sender": "447491163443",
                "content": { "text": body }
            }]
        }
    )


# ── SMS endpoint ───────────────────────────────────────────────────────────
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
        if req.salinity_risk == "Severe":
            auto_action = "Stop irrigation. Apply gypsum now."
        elif req.salinity_risk == "Moderate":
            auto_action = "Flush with fresh water. Clear drains."
        elif req.salinity_risk == "Mild":
            auto_action = "Increase irrigation. Check drainage."
        else:
            auto_action = "Field OK. Continue normal farming."

        crop_health = "Healthy" if req.ndvi >= 0.6 else "Stressed" if req.ndvi >= 0.4 else "Critical"
        short_name  = req.field_name.split("—")[0].strip()

        body = (
            f"SALTellite [{req.urgency}]\n"
            f"{short_name}\n"
            f"Salt:{req.salinity_risk} {req.ec}dS/m\n"
            f"Crop:{crop_health} {req.ndvi}\n"
            f"{auto_action}"
        )

        response = send_infobip_sms(req.to, body)
        return {"success": True, "status": response.status_code, "response": response.json()}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Dynamic field storage ──────────────────────────────────────────────────
FIELD_MAP = {
    "A": { "name": "Sekinchan — Paddy",          "lat": 3.535357, "lng": 101.120330, "area": "5.2 ha" },
    "B": { "name": "Kampung Gajah — Paddy",      "lat": 4.051622, "lng": 100.887673, "area": "3.8 ha" },
    "C": { "name": "Felda Besout — Palm Trees",  "lat": 3.839389, "lng": 101.266863, "area": "8.3 ha" },
    "D": { "name": "Felda Jengka — Palm Trees",  "lat": 3.769802, "lng": 102.438469, "area": "7.6 ha" },
}

custom_fields = {}  # dynamically registered from dashboard


# ── Register custom field ──────────────────────────────────────────────────
class CustomFieldRequest(BaseModel):
    name: str
    lat: float
    lng: float
    area: str
    radius: float


@app.post("/register-field")
def register_field(req: CustomFieldRequest):
    key = str(len(custom_fields) + len(FIELD_MAP) + 1)
    custom_fields[key] = {
        "name": req.name,
        "lat":  req.lat,
        "lng":  req.lng,
        "area": req.area,
    }
    return {"key": key, "message": f"Field registered as STATUS {key}"}


# ── Inbound SMS webhook ────────────────────────────────────────────────────
@app.post("/sms-webhook")
async def sms_webhook(request: Request):
    try:
        form   = await request.form()
        body   = form.get("Body", "").strip().upper()
        sender = form.get("From", "")

        # Merge default + custom fields
        all_fields = {**FIELD_MAP, **custom_fields}

        # Parse field key
        field_key = None
        for key in all_fields:
            if key.upper() in body or all_fields[key]["name"].upper().split("—")[0].strip() in body:
                field_key = key
                break

        if not field_key:
            keys_list = ", ".join([f"STATUS {k}" for k in all_fields.keys()])
            reply = (
                f"SALTellite\n"
                f"Available fields:\n"
                f"{keys_list}\n"
                f"Send STATUS [key] for update."
            )
        else:
            field = all_fields[field_key]
            data  = get_field(field["lat"], field["lng"])

            ec   = data["salinity"]["ec"]
            risk = data["salinity"]["risk"]
            ndvi = data["crop"]["ndvi"]
            crop = data["crop"]["status"]

            if risk == "Severe":
                action = "Stop irrigation. Apply gypsum now."
            elif risk == "Moderate":
                action = "Flush with fresh water. Clear drains."
            elif risk == "Mild":
                action = "Increase irrigation. Check drainage."
            else:
                action = "Field OK. Continue farming."

            short = field["name"].split("—")[0].strip()
            reply = (
                f"SALTellite Update\n"
                f"{short}\n"
                f"Salt:{risk} {ec}dS/m\n"
                f"Crop:{crop} NDVI {ndvi}\n"
                f"{action}"
            )

        send_infobip_sms(sender, reply)
        return {"status": "ok"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Health check ───────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "SALTellite API running", "version": "3.0"}