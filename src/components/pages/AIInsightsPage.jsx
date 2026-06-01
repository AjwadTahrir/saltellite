import { useState, useCallback } from "react";
import axios from "axios";

const API = "https://saltellite-api.onrender.com";

/**
 * AIInsightsPage — runs the existing /analyze endpoint across ALL fields and
 * shows risk-ranked insight cards. Reuses the same endpoint the dashboard uses.
 *
 * Props:
 *   fields, fieldData
 */
export default function AIInsightsPage({ fields, fieldData }) {
  const [results, setResults] = useState({});   // { [id]: analysis }
  const [running, setRunning] = useState(false);

  const runAll = useCallback(async () => {
    setRunning(true);
    const out = {};
    await Promise.all(
      fields.map(async (f) => {
        const data = fieldData[f.id];
        if (!data) return;
        try {
          const res = await axios.post(`${API}/analyze`, {
            field_name: f.name,
            ndvi: data.crop.ndvi,
            ndsi: data.indices.ndsi,
            ndwi: data.indices.ndwi,
            bsi: data.indices.bsi,
            ec: data.salinity.ec,
            salinity_risk: data.salinity.risk,
            crop_status: data.crop.status,
            area: f.area,
            date: data.date,
          });
          out[f.id] = res.data;
        } catch (err) {
          out[f.id] = { error: err.response?.data?.detail || err.message };
        }
      })
    );
    setResults(out);
    setRunning(false);
  }, [fields, fieldData]);

  const order = { CRITICAL: 0, WARNING: 1, NORMAL: 2 };
  const ranked = fields
    .map(f => ({ field: f, a: results[f.id] }))
    .filter(x => x.a && !x.a.error)
    .sort((x, y) => (order[x.a.urgency] ?? 3) - (order[y.a.urgency] ?? 3));

  const criticalCount = ranked.filter(r => r.a.urgency === "CRITICAL").length;
  const warningCount  = ranked.filter(r => r.a.urgency === "WARNING").length;

  const urgencyColor = (u) =>
    u === "CRITICAL" ? "#dc2626" : u === "WARNING" ? "#d97706" : "#0d9488";

  return (
    <div className="page-wrap">
      <div className="page-head">
        <h2 className="page-title">AI Insights</h2>
        <p className="page-sub">Llama 3.3 agronomic analysis across every monitored field</p>
      </div>

      {Object.keys(results).length === 0 ? (
        <div className="sidebar-section" style={{ margin: 0, textAlign: "center", padding: "3rem 1.5rem" }}>
          <div style={{ fontSize: "0.9rem", color: "var(--text-dim)", marginBottom: "1.25rem", lineHeight: 1.6 }}>
            Run AI saline-intrusion analysis across all {fields.length} fields at once.<br />
            Results are ranked by urgency.
          </div>
          <button className="ai-run-btn" style={{ maxWidth: 280, margin: "0 auto" }} onClick={runAll} disabled={running}>
            {running ? "Analyzing all fields…" : "Run AI Analysis on All Fields"}
          </button>
        </div>
      ) : (
        <>
          {/* summary strip */}
          <div className="page-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "0.85rem" }}>
            <div className="sidebar-section" style={{ margin: 0 }}>
              <div className="stat-label">Critical</div>
              <div className="stat-value red">{criticalCount}</div>
              <div className="stat-sub">need immediate action</div>
            </div>
            <div className="sidebar-section" style={{ margin: 0 }}>
              <div className="stat-label">Warning</div>
              <div className="stat-value yellow">{warningCount}</div>
              <div className="stat-sub">monitor closely</div>
            </div>
            <div className="sidebar-section" style={{ margin: 0 }}>
              <div className="stat-label">Analyzed</div>
              <div className="stat-value green">{ranked.length}</div>
              <div className="stat-sub">of {fields.length} fields</div>
            </div>
          </div>

          <button className="ai-run-btn" style={{ maxWidth: 200, marginBottom: "0.85rem", opacity: 0.8, fontSize: "0.8rem" }} onClick={runAll} disabled={running}>
            {running ? "Re-analyzing…" : "Re-run analysis"}
          </button>

          {/* ranked insight cards */}
          <div className="page-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
            {ranked.map(({ field, a }) => (
              <div key={field.id} className="sidebar-section" style={{ margin: 0, borderLeft: `3px solid ${urgencyColor(a.urgency)}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <strong style={{ fontSize: "0.9rem" }}>{field.name}</strong>
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, color: urgencyColor(a.urgency), background: urgencyColor(a.urgency) + "18", padding: "0.2rem 0.6rem", borderRadius: 999 }}>
                    {a.urgency}
                  </span>
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--text)", lineHeight: 1.6, marginBottom: "0.6rem" }}>{a.summary}</div>
                {a.recommendations?.length > 0 && (
                  <div>
                    <div className="ai-label">Recommended</div>
                    {a.recommendations.slice(0, 2).map((r, i) => (
                      <div key={i} className="ai-rec"><span>→</span><span>{r}</span></div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
