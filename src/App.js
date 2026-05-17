import { useState, useEffect, useCallback, useRef } from "react";
import { MapContainer, TileLayer, Circle, Popup, useMap } from "react-leaflet";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
import axios from "axios";
import "leaflet/dist/leaflet.css";
import "./App.css";

const API = "http://localhost:8000";

const FIELDS = [
  { id: 1, name: "Sekinchan — Paddy",        lat: 3.535357, lng: 101.120330, area: "5.2 ha" },
  { id: 2, name: "Kampung Gajah — Paddy",    lat: 4.051622, lng: 100.887673, area: "3.8 ha" },
  { id: 3, name: "Felda Besout — Palm Trees",  lat: 3.839389, lng: 101.266863, area: "8.3 ha" },
  { id: 4, name: "Felda Jengka — Palm Trees",  lat: 3.769802, lng: 102.438469, area: "7.6 ha" },
];

function salinityColor(risk) {
  if (!risk) return "#ccc";
  if (risk === "Safe")     return "#5a826a";
  if (risk === "Mild")     return "#b8832a";
  if (risk === "Moderate") return "#c07030";
  return "#c55a3e";
}

function ndviColor(v) {
  if (v === null || v === undefined) return "#ccc";
  if (v >= 0.6) return "#5a826a";
  if (v >= 0.4) return "#b8832a";
  return "#c55a3e";
}

function ndviLabel(v) {
  if (v === null || v === undefined) return "loading";
  if (v >= 0.6) return "good";
  if (v >= 0.4) return "warning";
  return "critical";
}

function generateNdviHistory(baseNdvi) {
  const months = ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];
  return months.map((month, i) => ({
    month,
    ndvi: +(Math.max(0.1, baseNdvi - 0.15 + (i * 0.03) + (Math.random() * 0.06 - 0.03))).toFixed(3),
  }));
}

function generateSalinityHistory(baseEc) {
  const months = ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];
  return months.map((month, i) => ({
    month,
    ec: +(Math.max(0.1, baseEc + (i * 0.1) - 0.3 + (Math.random() * 0.4 - 0.2))).toFixed(2),
  }));
}

function MapFlyTo({ field }) {
  const map = useMap();
  const prevId = useRef(null);
  useEffect(() => {
    if (prevId.current !== field.id) {
      prevId.current = field.id;
      map.flyTo([field.lat, field.lng], 14, { duration: 1.0, easeLinearity: 0.5 });
    }
  }, [field, map]);
  return null;
}

function RiskGauge({ score }) {
  const color = score >= 70 ? "#5a826a" : score >= 40 ? "#b8832a" : "#c55a3e";
  const angle = (score / 100) * 180 - 90;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "0.25rem 0" }}>
      <svg width="130" height="70" viewBox="0 0 130 70">
        <path d="M15,65 A50,50 0 0,1 115,65" fill="none" stroke="#e2dbd0" strokeWidth="10" strokeLinecap="round"/>
        <path d="M15,65 A50,50 0 0,1 115,65" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${(score / 100) * 157} 157`}/>
        <line x1="65" y1="65"
          x2={65 + 38 * Math.cos((angle - 90) * Math.PI / 180)}
          y2={65 + 38 * Math.sin((angle - 90) * Math.PI / 180)}
          stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
        <circle cx="65" cy="65" r="5" fill={color}/>
        <text x="65" y="34" textAnchor="middle" fill={color} fontSize="16" fontWeight="bold" fontFamily="Playfair Display">{score}</text>
      </svg>
      <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: "-0.5rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>Health Score</div>
    </div>
  );
}

export default function App() {
  const [time, setTime]               = useState(new Date());
  const [activeField, setActive]      = useState(FIELDS[0]);
  const [mapMode, setMapMode]         = useState("SALINITY");
  const [fieldData, setFieldData]     = useState({});
  const [loading, setLoading]         = useState(true);
  const [ndviHistory, setNdviHistory] = useState([]);
  const [salinityHistory, setSalinityHistory] = useState([]);
  const [analysis, setAnalysis]       = useState(null);
  const [analyzing, setAnalyzing]     = useState(false);
  const [alerts, setAlerts]           = useState([{ type: "info", msg: "Fetching live satellite data…" }]);
  const [smsLog, setSmsLog]           = useState([]);
  const [phone, setPhone]             = useState("+60");
  const [sending, setSending]         = useState(false);
  const [activeTab, setActiveTab]     = useState("salinity");

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch all field data on mount
  useEffect(() => {
    async function fetchAll() {
      setLoading(true);
      const results = {};
      const newAlerts = [];

      await Promise.all(
        FIELDS.map(async (field) => {
          try {
            const res = await axios.get(`${API}/field`, { params: { lat: field.lat, lng: field.lng } });
            results[field.id] = res.data;

            const ec   = res.data.salinity.ec;
            const risk = res.data.salinity.risk;
            if (risk === "Severe" || risk === "Moderate")
              newAlerts.push({ type: "critical", msg: `${field.name}: Salinity ${ec} dS/m — ${risk}` });
            else if (risk === "Mild")
              newAlerts.push({ type: "warning", msg: `${field.name}: Mild salinity detected (${ec} dS/m)` });
          } catch {
            results[field.id] = null;
          }
        })
      );

      setFieldData(results);
      setLoading(false);
      newAlerts.push({ type: "info", msg: "Sentinel-2 revisit cycle: every 5 days over Selangor" });
      setAlerts(newAlerts.length > 1 ? newAlerts : [
        { type: "info", msg: "All fields show safe salinity levels" },
        { type: "info", msg: "Sentinel-2 revisit cycle: every 5 days over Selangor" },
      ]);
    }
    fetchAll();
  }, []);

  // Update history when active field changes
  useEffect(() => {
    const data = fieldData[activeField.id];
    setNdviHistory(generateNdviHistory(data?.crop?.ndvi ?? 0.5));
    setSalinityHistory(generateSalinityHistory(data?.salinity?.ec ?? 2.0));
    setAnalysis(null);
  }, [activeField, fieldData]);

  const runAnalysis = useCallback(async () => {
    const data = fieldData[activeField.id];
    if (!data) return;
    setAnalyzing(true);
    setActiveTab("ai");
    try {
      const res = await axios.post(`${API}/analyze`, {
        field_name:    activeField.name,
        ndvi:          data.crop.ndvi,
        ndsi:          data.indices.ndsi,
        ndwi:          data.indices.ndwi,
        bsi:           data.indices.bsi,
        ec:            data.salinity.ec,
        salinity_risk: data.salinity.risk,
        crop_status:   data.crop.status,
        area:          activeField.area,
        date:          data.date,
      });
      setAnalysis(res.data);
      if (res.data.urgency === "CRITICAL")
        setAlerts(prev => [{ type: "critical", msg: `AI: ${activeField.name} needs immediate attention` }, ...prev.slice(0, 3)]);
      else if (res.data.urgency === "WARNING")
        setAlerts(prev => [{ type: "warning", msg: `AI: ${activeField.name} — ${res.data.issues?.[0] ?? "monitor closely"}` }, ...prev.slice(0, 3)]);
    } catch (err) {
      setAnalysis({ error: err.response?.data?.detail || err.message });
    }
    setAnalyzing(false);
  }, [activeField, fieldData]);

  const sendSMS = useCallback(async () => {
    if (!phone || sending) return;
    setSending(true);
    const data = fieldData[activeField.id];
    try {
      await axios.post(`${API}/send-sms`, {
        to:              phone,
        field_name:      activeField.name,
        ec:              data?.salinity?.ec ?? 0,
        salinity_risk:   data?.salinity?.risk ?? "Unknown",
        ndvi:            data?.crop?.ndvi ?? 0,
        urgency:         analysis?.urgency ?? "NORMAL",
        summary:         analysis?.summary ?? "",
        recommendations: analysis?.recommendations ?? [],
      });
      setSmsLog(prev => [{ time: time.toLocaleTimeString(), msg: `Sent to ${phone} — ${activeField.name}` }, ...prev]);
      setAlerts(prev => [{ type: "info", msg: `Alert sent to ${phone}` }, ...prev.slice(0, 3)]);
    } catch (err) {
      setSmsLog(prev => [{ time: time.toLocaleTimeString(), msg: `Failed: ${err.response?.data?.detail || err.message}` }, ...prev]);
    }
    setSending(false);
  }, [phone, sending, activeField, fieldData, analysis, time]);

  const activeData     = fieldData[activeField.id];
  const activeEc       = activeData?.salinity?.ec ?? null;
  const activeRisk     = activeData?.salinity?.risk ?? null;
  const activeNdvi     = activeData?.crop?.ndvi ?? null;
  const activeIndices  = activeData?.indices ?? {};

  const allEc      = Object.values(fieldData).filter(Boolean).map(d => d.salinity.ec);
  const avgEc      = allEc.length ? (allEc.reduce((a, b) => a + b, 0) / allEc.length).toFixed(2) : "…";
  const criticalFields = Object.values(fieldData).filter(Boolean).filter(d => d.salinity.risk === "Severe" || d.salinity.risk === "Moderate").length;

  const urgencyColor = analysis?.urgency === "CRITICAL" ? "var(--red)" : analysis?.urgency === "WARNING" ? "var(--yellow)" : "var(--sage-dark)";

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <div className="logo-icon">🌊</div>
          <div>
            <div className="logo-text">SALTellite</div>
            <div className="logo-sub">Saline Intrusion Detection via Satellite + AI</div>
          </div>
        </div>
        <div className="header-right">
          <div className="status-badge">
            <div className="pulse" />
            {loading ? "Fetching satellite data…" : "Live — Sentinel-2 + ML Model"}
          </div>
          <div className="time">{time.toLocaleTimeString()}</div>
        </div>
      </header>

      <div className="main">
        {/* Stats */}
        <div className="stats-bar">
          {[
            { label: "Fields Monitored", value: "4",                          sub: "Selangor, MY",                    cls: "green",  w: "100%",             bg: "var(--sage)" },
            { label: "Avg Salinity",     value: loading ? "…" : `${avgEc}`,   sub: loading ? "Loading…" : "dS/m — ML Prediction", cls: "yellow", w: `${Math.min(avgEc * 10, 100)}%`, bg: "var(--sandy-dark)" },
            { label: "At-Risk Fields",   value: loading ? "…" : criticalFields, sub: "Moderate or Severe",            cls: criticalFields > 0 ? "red" : "green", w: `${criticalFields * 25}%`, bg: "var(--red)" },
            { label: "Active Alerts",    value: alerts.filter(a => a.type !== "info").length, sub: "Require attention", cls: "red",  w: "60%",              bg: "var(--red)" },
            { label: "AI Status",        value: analysis ? analysis.urgency : "—", sub: analysis ? analysis.health_label : "Run analysis", cls: analysis ? (analysis.urgency === "CRITICAL" ? "red" : analysis.urgency === "WARNING" ? "yellow" : "green") : "", w: analysis ? `${analysis.risk_score}%` : "0%", bg: urgencyColor },
          ].map((s, i) => (
            <div key={i} className="stat">
              <div className="stat-label">{s.label}</div>
              <div className={`stat-value ${s.cls}`}>{s.value}</div>
              <div className="stat-sub">{s.sub}</div>
              <div className="stat-bar" style={{ width: s.w, background: s.bg }} />
            </div>
          ))}
        </div>

        {/* Map */}
        <div className="map-section">
          <div className="map-header">
            <div className="map-title">
              {loading ? "Loading satellite data…" : `${activeField.name} — Salinity ${activeEc ?? "N/A"} dS/m (${activeRisk ?? "…"})`}
            </div>
            <div className="map-controls">
              {["SALINITY", "NDVI", "NDWI"].map(m => (
                <button key={m} className={`map-btn ${mapMode === m ? "active" : ""}`} onClick={() => setMapMode(m)}>{m}</button>
              ))}
            </div>
          </div>

          <div className="map-container">
            <MapContainer center={[3.139, 101.6869]} zoom={13} style={{ height: "100%", width: "100%" }} zoomControl={false} scrollWheelZoom={true}>
              <MapFlyTo field={activeField} />
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
              {FIELDS.map(f => {
                const fd    = fieldData[f.id];
                const color = mapMode === "SALINITY"
                  ? salinityColor(fd?.salinity?.risk)
                  : ndviColor(fd?.crop?.ndvi ?? null);
                return (
                  <Circle key={f.id} center={[f.lat, f.lng]} radius={300}
                    pathOptions={{ color, fillColor: color, fillOpacity: activeField.id === f.id ? 0.65 : 0.4, weight: activeField.id === f.id ? 3 : 1.5 }}
                    eventHandlers={{ click: () => setActive(f) }}>
                    <Popup>
                      <div style={{ fontFamily: "DM Mono, monospace", fontSize: "13px", padding: "4px", lineHeight: 1.7 }}>
                        <strong>{f.name}</strong><br />
                        Salinity: {fd?.salinity?.ec ?? "…"} dS/m ({fd?.salinity?.risk ?? "…"})<br />
                        NDVI: {fd?.crop?.ndvi ?? "…"} — {fd?.crop?.status ?? "…"}<br />
                        Date: {fd?.date ?? "…"}<br />
                        Area: {f.area}
                      </div>
                    </Popup>
                  </Circle>
                );
              })}
            </MapContainer>
          </div>

          <div className="ndvi-legend">
            <div className="ndvi-legend-title">{mapMode === "SALINITY" ? "Salinity Risk" : "NDVI Index"}</div>
            <div className="ndvi-bar" style={mapMode === "SALINITY" ? { background: "linear-gradient(to right, #5a826a, #b8832a, #c07030, #c55a3e)" } : {}} />
            <div className="ndvi-labels">
              {mapMode === "SALINITY"
                ? <><span>Safe</span><span>Mild</span><span>Severe</span></>
                : <><span>Bare</span><span>Sparse</span><span>Healthy</span></>
              }
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="sidebar">

          {/* Fields */}
          <div className="sidebar-section">
            <div className="section-title">Fields</div>
            <div className="field-list">
              {FIELDS.map(f => {
                const fd   = fieldData[f.id];
                const risk = fd?.salinity?.risk ?? null;
                const ec   = fd?.salinity?.ec ?? null;
                return (
                  <div key={f.id} className={`field-item ${activeField.id === f.id ? "active" : ""}`} onClick={() => setActive(f)}>
                    <div className="field-name">{f.name}</div>
                    <div className={`field-ndvi ndvi-${risk === "Safe" ? "good" : risk === "Mild" ? "warn" : risk ? "bad" : "good"}`}>
                      {ec !== null ? `${ec} dS/m — ${risk}` : "Loading…"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tabs */}
          <div className="tab-bar">
            {[
              { id: "salinity", label: "Salinity" },
              { id: "crop",     label: "Crop Health" },
              { id: "ai",       label: "AI Analysis" },
              { id: "history",  label: "History" },
            ].map(tab => (
              <button key={tab.id} className={`tab-btn ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Salinity Tab */}
          {activeTab === "salinity" && (
            <div className="sidebar-section">
              {activeData ? (
                <>
                  {/* EC reading */}
                  <div style={{ background: "var(--surface)", border: `2px solid ${salinityColor(activeRisk)}`, borderRadius: "var(--radius)", padding: "1rem", marginBottom: "0.75rem", textAlign: "center" }}>
                    <div style={{ fontSize: "0.68rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: "0.4rem" }}>Predicted Soil Salinity</div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem", color: salinityColor(activeRisk), lineHeight: 1 }}>{activeEc}</div>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-dim)", marginTop: "0.3rem" }}>dS/m — Electrical Conductivity</div>
                    <div style={{ marginTop: "0.6rem", display: "inline-block", padding: "0.3rem 1rem", borderRadius: "999px", background: salinityColor(activeRisk) + "22", border: `1.5px solid ${salinityColor(activeRisk)}`, color: salinityColor(activeRisk), fontSize: "0.8rem", fontWeight: 700 }}>
                      {activeRisk}
                    </div>
                  </div>

                  {/* Satellite indices */}
                  <div className="section-title" style={{ marginBottom: "0.6rem" }}>Satellite Indices</div>
                  <div className="sensor-grid">
                    {[
                      { name: "NDSI", val: activeIndices.ndsi, desc: "Salinity Index",   good: v => v < 0,    tip: "Higher = more saline" },
                      { name: "NDWI", val: activeIndices.ndwi, desc: "Water Index",      good: v => v < 0,    tip: "Higher = waterlogged" },
                      { name: "BSI",  val: activeIndices.bsi,  desc: "Bare Soil Index",  good: v => v < 0,    tip: "Higher = less vegetation" },
                      { name: "EVI",  val: activeIndices.evi,  desc: "Enhanced Veg.",    good: v => v > 0.4,  tip: "Higher = healthier crops" },
                    ].map(s => {
                      const status = s.val === undefined ? "good" : s.good(s.val) ? "good" : "warning";
                      return (
                        <div key={s.name} className={`sensor-card ${status}`}>
                          <div className="sensor-name">{s.name}</div>
                          <div className={`sensor-value ${status}`}>{s.val?.toFixed(3) ?? "…"}</div>
                          <div className="sensor-unit">{s.desc}</div>
                          <div className="sensor-trend" style={{ color: "var(--text-dim)", fontWeight: 400 }}>{s.tip}</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div style={{ color: "var(--text-dim)", fontSize: "0.85rem", padding: "1rem 0" }}>Loading satellite data…</div>
              )}
            </div>
          )}

          {/* Crop Health Tab */}
          {activeTab === "crop" && (
            <div className="sidebar-section">
              {activeData ? (
                <>
                  <div style={{ background: "var(--surface)", border: `2px solid ${ndviColor(activeNdvi)}`, borderRadius: "var(--radius)", padding: "1rem", marginBottom: "0.75rem", textAlign: "center" }}>
                    <div style={{ fontSize: "0.68rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: "0.4rem" }}>Vegetation Health (NDVI)</div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem", color: ndviColor(activeNdvi), lineHeight: 1 }}>{activeNdvi?.toFixed(3) ?? "…"}</div>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-dim)", marginTop: "0.3rem" }}>Normalized Difference Vegetation Index</div>
                    <div style={{ marginTop: "0.6rem", display: "inline-block", padding: "0.3rem 1rem", borderRadius: "999px", background: ndviColor(activeNdvi) + "22", border: `1.5px solid ${ndviColor(activeNdvi)}`, color: ndviColor(activeNdvi), fontSize: "0.8rem", fontWeight: 700 }}>
                      {activeData.crop.status}
                    </div>
                  </div>

                  <div className="section-title" style={{ marginBottom: "0.6rem" }}>Additional Indices</div>
                  <div className="sensor-grid">
                    {[
                      { name: "NDVI", val: activeIndices.ndvi, desc: "Veg. Index",    good: v => v > 0.5 },
                      { name: "SAVI", val: activeIndices.savi, desc: "Soil-Adj. Veg", good: v => v > 0.4 },
                      { name: "EVI",  val: activeIndices.evi,  desc: "Enhanced Veg.", good: v => v > 0.4 },
                      { name: "BSI",  val: activeIndices.bsi,  desc: "Bare Soil",     good: v => v < 0 },
                    ].map(s => {
                      const status = s.val === undefined ? "good" : s.good(s.val) ? "good" : "warning";
                      return (
                        <div key={s.name} className={`sensor-card ${status}`}>
                          <div className="sensor-name">{s.name}</div>
                          <div className={`sensor-value ${status}`}>{s.val?.toFixed(3) ?? "…"}</div>
                          <div className="sensor-unit">{s.desc}</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div style={{ color: "var(--text-dim)", fontSize: "0.85rem", padding: "1rem 0" }}>Loading…</div>
              )}
            </div>
          )}

          {/* AI Tab */}
          {activeTab === "ai" && (
            <div className="sidebar-section">
              <div className="ai-panel">
                {!analysis && !analyzing && (
                  <div style={{ textAlign: "center", padding: "0.5rem 0 0.75rem" }}>
                    <div style={{ fontSize: "0.85rem", color: "var(--text-dim)", marginBottom: "1.1rem", lineHeight: 1.6 }}>
                      Run AI saline intrusion analysis for<br />
                      <strong style={{ color: "var(--sage-dark)" }}>{activeField.name}</strong>
                    </div>
                    <button className="ai-run-btn" onClick={runAnalysis} disabled={!activeData}>Run AI Analysis</button>
                  </div>
                )}
                {analyzing && (
                  <div style={{ textAlign: "center", padding: "1.5rem 0" }}>
                    <div className="pulse" style={{ margin: "0 auto 1rem", background: "var(--sage)", width: 12, height: 12 }} />
                    <div style={{ fontSize: "0.85rem", color: "var(--sage-dark)", fontWeight: 600 }}>Analyzing saline intrusion risk…</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: "0.4rem" }}>Powered by Llama 3.3 via Groq</div>
                  </div>
                )}
                {analysis && !analyzing && !analysis.error && (
                  <>
                    <RiskGauge score={analysis.risk_score} />
                    <div className="ai-badge" style={{ background: urgencyColor + "18", border: `1.5px solid ${urgencyColor}`, color: urgencyColor }}>
                      {analysis.urgency} — {analysis.health_label}
                    </div>
                    <div className="ai-summary">{analysis.summary}</div>
                    {analysis.issues?.length > 0 && (
                      <div>
                        <div className="ai-label">Issues Detected</div>
                        {analysis.issues.map((issue, i) => (
                          <div key={i} className="ai-issue"><span>—</span><span>{issue}</span></div>
                        ))}
                      </div>
                    )}
                    {analysis.recommendations?.length > 0 && (
                      <div>
                        <div className="ai-label">Recommended Actions</div>
                        {analysis.recommendations.map((rec, i) => (
                          <div key={i} className="ai-rec"><span>→</span><span>{rec}</span></div>
                        ))}
                      </div>
                    )}
                    <button className="ai-run-btn" style={{ opacity: 0.7, fontSize: "0.78rem" }} onClick={runAnalysis}>Re-analyze</button>
                  </>
                )}
                {analysis?.error && (
                  <div style={{ fontSize: "0.8rem", color: "var(--red)", padding: "0.85rem", background: "#c55a3e10", borderRadius: "10px", border: "1.5px solid var(--red)" }}>
                    Error: {analysis.error}
                    <button className="ai-run-btn" style={{ marginTop: "0.65rem" }} onClick={runAnalysis}>Retry</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* History Tab */}
          {activeTab === "history" && (
            <div className="sidebar-section">
              <div className="ai-label">6-Month Salinity Trend (EC dS/m)</div>
              <ResponsiveContainer width="100%" height={95}>
                <AreaChart data={salinityHistory}>
                  <defs>
                    <linearGradient id="ecGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#c55a3e" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#c55a3e" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#8a8278", fontFamily: "DM Mono" }} />
                  <YAxis hide />
                  <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2dbd0", borderRadius: "10px", fontFamily: "DM Mono", fontSize: "12px" }} />
                  <Area type="monotone" dataKey="ec" stroke="#c07030" strokeWidth={2} fill="url(#ecGrad)" dot={{ fill: "#c07030", r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>

              <div className="ai-label" style={{ marginTop: "1rem" }}>6-Month NDVI Trend</div>
              <ResponsiveContainer width="100%" height={85}>
                <AreaChart data={ndviHistory}>
                  <defs>
                    <linearGradient id="ndviGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#9BB5A3" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#9BB5A3" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#8a8278", fontFamily: "DM Mono" }} interval={1} />
                  <YAxis hide />
                  <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2dbd0", borderRadius: "10px", fontFamily: "DM Mono", fontSize: "12px" }} />
                  <Area type="monotone" dataKey="ndvi" stroke="#5a826a" strokeWidth={2} fill="url(#ndviGrad)" dot={{ fill: "#5a826a", r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Alerts */}
          <div className="sidebar-section">
            <div className="section-title">Alerts</div>
            <div className="alert-list">
              {alerts.slice(0, 4).map((a, i) => (
                <div key={i} className={`alert-item ${a.type}`}>
                  <div className="alert-dot" />{a.msg}
                </div>
              ))}
            </div>
          </div>

          {/* SMS */}
          <div className="sidebar-section">
            <div className="section-title">SMS Alert</div>
            <div className="sms-panel">
              <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
                {analysis ? "Sending AI recommendation for " : "Alert for "}
                <strong style={{ color: "var(--sage-dark)" }}>{activeField.name}</strong>
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", background: "var(--sage-dim)", border: "1px solid var(--sage-light)", borderRadius: "8px", padding: "0.5rem 0.75rem" }}>
                Farmer can also SMS <strong>STATUS A</strong> to get updates
              </div>
              <div className="sms-input-row">
                <input className="sms-input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+60XXXXXXXXX" />
                <button className="sms-btn" onClick={sendSMS} disabled={sending || loading}>
                  {sending ? "…" : "Send"}
                </button>
              </div>
              {!analysis && (
                <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>
                  Run AI Analysis first for smarter alerts
                </div>
              )}
              {smsLog.length > 0 && (
                <div className="sms-log">
                  {smsLog.map((s, i) => (
                    <div key={i} className="sms-log-entry">
                      <span className="sms-log-time">{s.time}</span>
                      <span>{s.msg}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}