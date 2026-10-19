"use client";
import { useEffect, useState } from "react";

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const TIMEZONES = ["Australia/Sydney","Australia/Melbourne","Australia/Brisbane","Australia/Adelaide","Australia/Darwin","Australia/Perth","Australia/Hobart","Pacific/Auckland","Asia/Singapore","Asia/Kolkata","Asia/Manila","Asia/Jakarta","Europe/London","America/New_York","America/Los_Angeles","UTC"];

export default function Settings() {
  const [s, setS] = useState(null);
  const [shop, setShop] = useState("");
  const [status, setStatus] = useState({ loading: true });
  const [saving, setSaving] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  const [maxLookback, setMaxLookback] = useState(60);
  const [vendors, setVendors] = useState([]);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json().then((j) => ({ ok: r.ok, j }))).then(({ ok, j }) => {
      if (!ok) { setStatus({ loading: false, ok: false, err: j.error }); return; }
      setShop(j.shop);
      setMaxLookback(j.maxLookback || 60);
      setVendors(j.vendors || []);
      setS({ ...defaults(), ...(j.settings || {}), vendorOverrides: (j.settings && j.settings.vendorOverrides) || [] });
      setStatus({ loading: false, ok: true });
    });
  }, []);

  function defaults() {
    return { notifyEmail: "", lookbackDays: 30, leadTimeDays: 14, targetCoverDays: 30, cadence: "weekly", dayOfWeek: 1, dayOfMonth: 1, hour: 9, timezone: "Australia/Sydney", enabled: true, vendorOverrides: [] };
  }
  const up = (k, v) => setS((p) => ({ ...p, [k]: v }));
  const upO = (idx, k, v) => setS((p) => ({ ...p, vendorOverrides: p.vendorOverrides.map((o, i) => (i === idx ? { ...o, [k]: v } : o)) }));
  const addO = () => setS((p) => ({ ...p, vendorOverrides: [...p.vendorOverrides, { vendor: "", leadTimeDays: "", targetCoverDays: "" }] }));
  const delO = (idx) => setS((p) => ({ ...p, vendorOverrides: p.vendorOverrides.filter((_, i) => i !== idx) }));

  async function save() {
    setSaving(true); setTestMsg("");
    const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
    const j = await r.json();
    setSaving(false);
    if (r.ok && j.settings) setS((p) => ({ ...p, ...j.settings }));
    setTestMsg(r.ok ? "Saved ✓" : (j.message || "Save failed"));
  }

  async function sendTest() {
    setTestMsg("Sending test…");
    const r = await fetch("/api/digest/test", { method: "POST" });
    const j = await r.json();
    setTestMsg(r.ok ? `Test sent to ${j.to} ✓` : (j.message || "Could not send test"));
  }

  if (status.loading) return <Shell><p>Loading…</p></Shell>;
  if (!status.ok) return <Shell><h2>Connect your store</h2><p style={{ color: "#6B7280" }}>You need to connect a Shopify store first.</p><a href="/" style={btn}>Go to connect</a></Shell>;

  return (
    <Shell sub={shop}>
      <div style={card}>
        <Row label="Notification email" hint="Where the restock digest is sent">
          <input style={inp} type="email" value={s.notifyEmail || ""} onChange={(e) => up("notifyEmail", e.target.value)} placeholder="you@yourstore.com" />
        </Row>

        <Row label="Cadence">
          <select style={inp} value={s.cadence} onChange={(e) => up("cadence", e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="fortnightly">Fortnightly</option>
            <option value="monthly">Monthly</option>
          </select>
        </Row>

        {(s.cadence === "weekly" || s.cadence === "fortnightly") && (
          <Row label="Day of week">
            <select style={inp} value={s.dayOfWeek} onChange={(e) => up("dayOfWeek", +e.target.value)}>
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </Row>
        )}
        {s.cadence === "monthly" && (
          <Row label="Day of month">
            <input style={inp} type="number" min="1" max="28" value={s.dayOfMonth} onChange={(e) => up("dayOfMonth", +e.target.value)} />
          </Row>
        )}

        <Row label="Send time (hour)" hint="Sent within the hour you choose. If a send is missed it goes out on the next run that day.">
          <select style={inp} value={s.hour} onChange={(e) => up("hour", +e.target.value)}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
        </Row>
        <Row label="Timezone">
          <select style={inp} value={s.timezone} onChange={(e) => up("timezone", e.target.value)}>
            {(TIMEZONES.includes(s.timezone) ? TIMEZONES : [s.timezone, ...TIMEZONES]).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
          </select>
        </Row>

        <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "18px 0" }} />

        <Row label="Sales lookback (days)" hint={`Window used to estimate velocity. Maximum ${maxLookback} days${maxLookback === 60 ? " (Shopify only shares the last 60 days of orders)" : ""}.`}>
          <input style={inp} type="number" min="7" max={maxLookback} value={s.lookbackDays} onChange={(e) => up("lookbackDays", +e.target.value)} />
        </Row>
        <Row label="Supplier lead time (days)">
          <input style={inp} type="number" min="0" max="365" value={s.leadTimeDays} onChange={(e) => up("leadTimeDays", +e.target.value)} />
        </Row>
        <Row label="Target days of cover">
          <input style={inp} type="number" min="1" max="365" value={s.targetCoverDays} onChange={(e) => up("targetCoverDays", +e.target.value)} />
        </Row>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#6B7280", marginBottom: 4 }}>Supplier overrides</label>
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "#9CA3AF" }}>
            Different lead time or cover for a supplier, matched on the product’s Vendor in Shopify. Leave a box blank to use the store default.
          </p>
          {s.vendorOverrides.map((o, idx) => (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) auto", gap: 6, marginBottom: 6 }}>
              <input style={inp} list="vendor-list" value={o.vendor} placeholder="Vendor" onChange={(e) => upO(idx, "vendor", e.target.value)} />
              <input style={inp} type="number" min="0" max="365" value={o.leadTimeDays ?? ""} placeholder="Lead (days)" onChange={(e) => upO(idx, "leadTimeDays", e.target.value)} />
              <input style={inp} type="number" min="1" max="365" value={o.targetCoverDays ?? ""} placeholder="Cover" onChange={(e) => upO(idx, "targetCoverDays", e.target.value)} />
              <button onClick={() => delO(idx)} aria-label="Remove override" style={{ ...btn, background: "#fff", border: "1.5px solid #E5E7EB", padding: "8px 12px" }}>✕</button>
            </div>
          ))}
          <datalist id="vendor-list">{vendors.map((v) => <option key={v} value={v} />)}</datalist>
          <button onClick={addO} style={{ ...btn, background: "#fff", border: "1.5px solid #E5E7EB", padding: "8px 14px", fontSize: 13 }}>+ Add supplier override</button>
          {vendors.length === 0 && <p style={{ margin: "6px 0 0", fontSize: 12, color: "#9CA3AF" }}>Open the dashboard once to load your supplier names here.</p>}
        </div>

        <Row label="Enabled" hint="Turn the scheduled digest on/off">
          <input type="checkbox" checked={!!s.enabled} onChange={(e) => up("enabled", e.target.checked)} />
        </Row>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 18, flexWrap: "wrap" }}>
          <button onClick={save} disabled={saving} style={btn}>{saving ? "Saving…" : "Save settings"}</button>
          <button onClick={sendTest} style={{ ...btn, background: "#fff", border: "1.5px solid #E5E7EB" }}>Send test digest now</button>
          <a href="/dashboard" style={{ color: "#4B5563", marginLeft: "auto" }}>← Dashboard</a>
        </div>
        {testMsg && <p style={{ marginTop: 12, color: "#374151" }}>{testMsg}</p>}
      </div>
    </Shell>
  );
}

const card = { background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "22px 24px", maxWidth: 560, margin: "0 auto" };
const inp = { width: "100%", padding: "9px 12px", border: "1.5px solid #E5E7EB", borderRadius: 9, fontSize: 14, fontFamily: "inherit", background: "#FAFAFA", outline: "none", boxSizing: "border-box" };
const btn = { display: "inline-block", background: "#BFFC00", color: "#0A0A0A", fontWeight: 800, padding: "10px 18px", borderRadius: 10, textDecoration: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 14 };

function Row({ label, hint, children }) {
  return <div style={{ marginBottom: 14 }}>
    <label style={{ display: "block", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#6B7280", marginBottom: 4 }}>{label}</label>
    {children}
    {hint && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9CA3AF" }}>{hint}</p>}
  </div>;
}
function Shell({ children, sub }) {
  return <main style={{ maxWidth: 600, margin: "0 auto", padding: "24px 16px 60px" }}>
    <div style={{ marginBottom: 16 }}>
      <span style={{ fontWeight: 900, fontSize: 22 }}>Settings</span>
      {sub && <span style={{ color: "#6B7280", marginLeft: 10, fontSize: 13 }}>{sub}</span>}
    </div>
    {children}
  </main>;
}
