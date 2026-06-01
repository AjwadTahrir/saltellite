import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from "recharts";

/**
 * AnalyticsPage — cross-field analytics built entirely from data the app
 * already has (fields + fieldData). No new fetches.
 *
 * Props:
 *   fields      array of field objects
 *   fieldData   { [id]: apiResponse }
 *   activeField currently selected field (for the index breakdown)
 *   salinityHistory / ndviHistory  the trend arrays App already generates
 */
export default function AnalyticsPage({ fields, fieldData, activeField, salinityHistory, ndviHistory }) {
  const loaded = fields.map(f => ({ field: f, data: fieldData[f.id] })).filter(x => x.data);

  // EC comparison across all fields
  const ecCompare = loaded.map(({ field, data }) => ({
    name: field.name.split(" — ")[0],
    ec: data.salinity.ec,
    risk: data.salinity.risk,
  }));

  // NDVI comparison across all fields
  const ndviCompare = loaded.map(({ field, data }) => ({
    name: field.name.split(" — ")[0],
    ndvi: data.crop.ndvi,
  }));

  // 6-index radar for the active field
  const idx = fieldData[activeField.id]?.indices ?? {};
  const radarData = [
    { index: "NDVI", value: Math.max(0, (idx.ndvi ?? 0)) },
    { index: "SAVI", value: Math.max(0, (idx.savi ?? 0)) },
    { index: "EVI",  value: Math.max(0, (idx.evi ?? 0)) },
    { index: "NDWI", value: Math.max(0, (idx.ndwi ?? 0) + 0.5) },
    { index: "NDSI", value: Math.max(0, (idx.ndsi ?? 0) + 0.5) },
    { index: "BSI",  value: Math.max(0, (idx.bsi ?? 0) + 0.5) },
  ];

  const barColor = (risk) =>
    risk === "Safe" ? "#0d9488" : risk === "Mild" ? "#d97706" : "#dc2626";

  return (
    <div className="page-wrap">
      <div className="page-head">
        <h2 className="page-title">Analytics</h2>
        <p className="page-sub">Cross-field salinity &amp; vegetation trends from the latest Sentinel-2 pass</p>
      </div>

      <div className="page-grid">
        {/* EC comparison */}
        <div className="sidebar-section" style={{ margin: 0 }}>
          <div className="section-title">Soil Salinity by Field (dS/m)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ecCompare} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b", fontFamily: "DM Mono" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <Tooltip cursor={false} contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, fontSize: 12, fontFamily: "DM Mono" }} />
              <Bar dataKey="ec" radius={[6, 6, 0, 0]} activeBar={{ filter: "drop-shadow(0 0 8px rgba(13,148,136,0.55))" }}>
                {ecCompare.map((d, i) => <Cell key={i} fill={barColor(d.risk)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* NDVI comparison */}
        <div className="sidebar-section" style={{ margin: 0 }}>
          <div className="section-title">Vegetation Health by Field (NDVI)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ndviCompare} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b", fontFamily: "DM Mono" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
              <YAxis domain={[0, 1]} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <Tooltip cursor={false} contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, fontSize: 12, fontFamily: "DM Mono" }} />
              <Bar dataKey="ndvi" radius={[6, 6, 0, 0]} fill="#0d9488" activeBar={{ filter: "drop-shadow(0 0 8px rgba(13,148,136,0.55))" }} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Salinity trend (active field) */}
        <div className="sidebar-section" style={{ margin: 0 }}>
          <div className="section-title">6-Month Salinity Trend — {activeField.name.split(" — ")[0]}</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={salinityHistory}>
              <defs>
                <linearGradient id="aEc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0891b2" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#0891b2" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#64748b", fontFamily: "DM Mono" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
              <YAxis hide />
              <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, fontSize: 12, fontFamily: "DM Mono" }} />
              <Area type="monotone" dataKey="ec" stroke="#0891b2" strokeWidth={2} fill="url(#aEc)" dot={{ fill: "#0891b2", r: 3 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* 6-index radar (active field) */}
        <div className="sidebar-section" style={{ margin: 0 }}>
          <div className="section-title">Spectral Index Profile — {activeField.name.split(" — ")[0]}</div>
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={radarData} outerRadius={75}>
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis dataKey="index" tick={{ fontSize: 11, fill: "#64748b", fontFamily: "DM Mono" }} />
              <Radar dataKey="value" stroke="#0d9488" fill="#0d9488" fillOpacity={0.35} />
              <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, fontSize: 12, fontFamily: "DM Mono" }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}