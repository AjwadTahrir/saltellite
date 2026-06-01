/**
 * FieldsPage — management view of every field (default + custom) as a clean
 * table. Pure presentation of the `fields` + `fieldData` the app already holds.
 *
 * Props:
 *   fields, fieldData
 *   onSelect(field)        jump to a field (e.g. switch to Dashboard + select)
 *   onRemove(id)           remove a custom field (reuses existing handler)
 */
function riskColor(risk) {
  if (risk === "Safe") return "#0d9488";
  if (risk === "Mild") return "#d97706";
  if (risk === "Moderate" || risk === "Severe") return "#dc2626";
  return "#64748b";
}

export default function FieldsPage({ fields, fieldData, onSelect, onRemove }) {
  return (
    <div className="page-wrap">
      <div className="page-head">
        <h2 className="page-title">Fields</h2>
        <p className="page-sub">{fields.length} monitored zones · {fields.filter(f => f.custom).length} custom</p>
      </div>

      <div className="sidebar-section" style={{ margin: 0, padding: 0, overflow: "hidden" }}>
        <table className="fields-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Salinity (dS/m)</th>
              <th>Risk</th>
              <th>NDVI</th>
              <th>Area</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => {
              const d = fieldData[f.id];
              const type = f.name.includes("Palm") ? "Palm" : f.name.includes("Paddy") ? "Paddy" : "Custom";
              return (
                <tr key={f.id} onClick={() => onSelect?.(f)} className="fields-row">
                  <td style={{ fontWeight: 600 }}>{f.name.split(" — ")[0]}</td>
                  <td style={{ color: "var(--text-dim)" }}>{type}</td>
                  <td style={{ fontFamily: "var(--font-mono)" }}>{d ? d.salinity.ec : "…"}</td>
                  <td>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: riskColor(d?.salinity?.risk), background: (d ? riskColor(d.salinity.risk) : "#64748b") + "18", padding: "0.2rem 0.6rem", borderRadius: 999 }}>
                      {d?.salinity?.risk ?? "…"}
                    </span>
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)" }}>{d?.crop?.ndvi?.toFixed(3) ?? "…"}</td>
                  <td style={{ color: "var(--text-dim)" }}>{f.area}</td>
                  <td>
                    {f.custom && (
                      <span
                        onClick={(e) => { e.stopPropagation(); onRemove?.(f.id); }}
                        style={{ color: "#dc2626", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600 }}
                      >
                        Remove
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
