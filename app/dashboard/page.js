"use client";
import { useEffect, useState } from "react";

const STATUS = {
  now:  { label: "Order now",    bg: "#FEF2F2", fg: "#DC2626" },
  soon: { label: "Reorder soon", bg: "#FFFBEB", fg: "#B45309" },
  ok:   { label: "Healthy",      bg: "#ECFDF5", fg: "#059669" },
  none: { label: "No recent sales", bg: "#F3F4F6", fg: "#6B7280" },
};
const RANK = { now: 0, soon: 1, ok: 2, none: 3 };
const STATUS_BY_RANK = ["now", "soon", "ok", "none"];
const PAGE_SIZE = 50; // products per page

export default function Dashboard() {
  const [state, setState] = useState({ loading: true });
  const [filters, setFilters] = useState({ lookback: 30, lead: 14, cover: 30 });
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [needsOnly, setNeedsOnly] = useState(true);
  const [expanded, setExpanded] = useState({});

  async function load(f, force) {
    setBusy(true);
    setPage(0);
    setExpanded({});
    try {
      const parts = [];
      if (f) parts.push(`lookback=${f.lookback}`, `lead=${f.lead}`, `cover=${f.cover}`);
      if (force) parts.push("refresh=1");
      const qs = parts.length ? "?" + parts.join("&") : "";
      const r = await fetch("/api/shop/data" + qs);
      const j = await r.json();
      setState({ loading: false, ok: r.ok, data: j });
      if (r.ok && j.params) {
        setFilters({ lookback: j.params.lookbackDays, lead: j.params.leadTimeDays, cover: j.params.targetCoverDays });
      }
    } catch (e) {
      setState({ loading: false, ok: false, data: { message: String(e) } });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(null); }, []);

  if (state.loading) return <Shell><p>Loading store data…</p></Shell>;
  if (!state.ok) {
    const notConnected = state.data && state.data.error === "not_connected";
    return <Shell>
      <h2 style={{ marginTop: 0 }}>{notConnected ? "Connect your store" : "Couldn’t load data"}</h2>
      <p style={{ color: "#6B7280" }}>{notConnected ? "You need to connect a Shopify store first." : (state.data && state.data.message)}</p>
      <a href="/" style={btn}>Go to connect</a>
    </Shell>;
  }

  const { items, summary, params, shop } = state.data;
  const sorted = [...items].sort((a, b) => (RANK[a.status] - RANK[b.status]) || (Math.min(a.daysCover, 1e9) - Math.min(b.daysCover, 1e9)));
  const visible = needsOnly ? sorted.filter((i) => i.status === "now" || i.status === "soon") : sorted;

  // Group variants under their parent product.
  const groupMap = new Map();
  for (const it of visible) {
    let g = groupMap.get(it.title);
    if (!g) { g = { title: it.title, variants: [], totalSold: 0, totalStock: 0, totalReorder: 0, worst: 3 }; groupMap.set(it.title, g); }
    g.variants.push(it);
    g.totalSold += it.unitsSold || 0;
    g.totalStock += it.stock || 0;
    g.totalReorder += it.reorderQty || 0;
    if (RANK[it.status] < g.worst) g.worst = RANK[it.status];
  }
  const groups = [...groupMap.values()].sort((a, b) => (a.worst - b.worst) || (b.totalReorder - a.totalReorder));
  const pageCount = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageGroups = groups.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const toggle = (t) => setExpanded((e) => ({ ...e, [t]: !e[t] }));
  const allOpen = pageGroups.length > 0 && pageGroups.every((g) => expanded[g.title]);
  const toggleAll = () => {
    const next = { ...expanded };
    for (const g of pageGroups) next[g.title] = !allOpen;
    setExpanded(next);
  };

  return (
    <Shell sub={shop}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end",
        background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "14px 16px", marginBottom: 16 }}>
        <Ctl label="Sales lookback (days)">
          <input type="number" min="7" max="365" value={filters.lookback}
            onChange={(e) => setFilters((f) => ({ ...f, lookback: +e.target.value }))} style={inp} />
        </Ctl>
        <Ctl label="Lead time (days)">
          <input type="number" min="0" max="365" value={filters.lead}
            onChange={(e) => setFilters((f) => ({ ...f, lead: +e.target.value }))} style={inp} />
        </Ctl>
        <Ctl label="Target cover (days)">
          <input type="number" min="1" max="365" value={filters.cover}
            onChange={(e) => setFilters((f) => ({ ...f, cover: +e.target.value }))} style={inp} />
        </Ctl>
        <button onClick={() => load(filters)} disabled={busy} style={applyBtn}>
          {busy ? "Loading…" : "Apply"}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#374151", cursor: "pointer" }}>
          <input type="checkbox" checked={needsOnly} onChange={(e) => { setNeedsOnly(e.target.checked); setPage(0); }} />
          Needs reorder only
        </label>
        <button onClick={() => load(filters, true)} disabled={busy} style={pageBtn} title="Re-fetch live from Shopify (bypass cache)">↻ Refresh</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
        <Card n={summary.orderNow} l="Order now" c="#DC2626" />
        <Card n={summary.reorderSoon} l="Reorder soon" c="#B45309" />
        <Card n={groups.length.toLocaleString()} l="Products" />
        <Card n={summary.unitsToOrder.toLocaleString()} l="Units to order" />
      </div>
      {!summary.hasSales && (
        <p style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 14, color: "#6B7280", marginBottom: 16 }}>
          No sales in the last {params.lookbackDays} days, so reorder quantities can’t be forecast. Try a longer lookback above, or check the store has recent orders.
        </p>
      )}
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#FAFBFC" }}>
              {["Product", "Variant", `Sold (${params.lookbackDays}d)`, "In stock", "Units/day", "Days cover", "Status", "Order qty"].map((h, i) => (
                <th key={h} style={{ ...th, textAlign: (i >= 2 && i <= 5) || i === 7 ? "right" : "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageGroups.map((g) => {
              const wm = STATUS[STATUS_BY_RANK[g.worst]];
              const open = !!expanded[g.title];
              const single = g.variants.length === 1;
              const rows = [
                <tr key={g.title} onClick={() => !single && toggle(g.title)}
                  style={{ cursor: single ? "default" : "pointer", background: open ? "#FAFBFC" : "#fff" }}>
                  <td style={{ ...td, fontWeight: 700, whiteSpace: "normal", maxWidth: 300 }}>
                    <span style={{ display: "inline-block", width: 16, color: "#9CA3AF" }}>{single ? "" : (open ? "▾" : "▸")}</span>
                    {g.title}
                  </td>
                  <td style={{ ...td, color: "#9CA3AF" }}>{single ? (g.variants[0].variant || "—") : `${g.variants.length} variants`}</td>
                  <td style={{ ...td, textAlign: "right" }}>{single ? g.variants[0].unitsSold : g.totalSold}</td>
                  <td style={{ ...td, textAlign: "right" }}>{single ? g.variants[0].stock : g.totalStock}</td>
                  <td style={{ ...td, textAlign: "right", color: single ? undefined : "#9CA3AF" }}>{single ? (g.variants[0].velocity ? g.variants[0].velocity.toFixed(2) : "0") : "—"}</td>
                  <td style={{ ...td, textAlign: "right", color: single ? undefined : "#9CA3AF" }}>{single ? (g.variants[0].daysCover === Infinity ? "∞" : Math.round(g.variants[0].daysCover)) : "—"}</td>
                  <td style={td}><span style={badge(wm)}>{wm.label}</span></td>
                  <td style={{ ...td, textAlign: "right", fontWeight: g.totalReorder > 0 ? 800 : 400 }}>{g.totalReorder > 0 ? g.totalReorder : "—"}</td>
                </tr>,
              ];
              if (open && !single) {
                for (const [vi, i] of g.variants.entries()) {
                  const m = STATUS[i.status];
                  rows.push(
                    <tr key={g.title + "|" + vi} style={{ background: "#FCFCFD" }}>
                      <td style={td}></td>
                      <td style={{ ...td, color: "#4B5563", whiteSpace: "normal", maxWidth: 220, paddingLeft: 24 }}>
                        {i.variant || "—"}{i.sku ? <span style={{ color: "#9CA3AF" }}> · {i.sku}</span> : null}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>{i.unitsSold}</td>
                      <td style={{ ...td, textAlign: "right" }}>{i.stock}</td>
                      <td style={{ ...td, textAlign: "right" }}>{i.velocity ? i.velocity.toFixed(2) : "0"}</td>
                      <td style={{ ...td, textAlign: "right" }}>{i.daysCover === null || i.daysCover === Infinity ? "∞" : Math.round(i.daysCover)}</td>
                      <td style={td}><span style={badge(m)}>{m.label}</span></td>
                      <td style={{ ...td, textAlign: "right", fontWeight: i.reorderQty > 0 ? 800 : 400 }}>{i.reorderQty > 0 ? i.reorderQty : "—"}</td>
                    </tr>
                  );
                }
              }
              return rows;
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
        <span style={{ color: "#6B7280", fontSize: 13 }}>
          Showing {groups.length === 0 ? 0 : safePage * PAGE_SIZE + 1}–{Math.min(groups.length, safePage * PAGE_SIZE + PAGE_SIZE)} of {groups.length.toLocaleString()} products
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={toggleAll} disabled={pageGroups.length === 0} style={pageBtn}>{allOpen ? "Collapse all" : "Expand all"}</button>
          <button onClick={() => setPage((x) => Math.max(0, x - 1))} disabled={safePage <= 0} style={pageBtn}>← Prev</button>
          <span style={{ fontSize: 13, color: "#374151" }}>Page {safePage + 1} of {pageCount}</span>
          <button onClick={() => setPage((x) => Math.min(pageCount - 1, x + 1))} disabled={safePage >= pageCount - 1} style={pageBtn}>Next →</button>
        </div>
      </div>
      <p style={{ textAlign: "center", marginTop: 14 }}><a href="/settings" style={{ color: "#4B5563" }}>Settings &amp; schedule →</a></p>
    </Shell>
  );
}

const th = { padding: "11px 14px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#6B7280", whiteSpace: "nowrap" };
const td = { padding: "11px 14px", borderTop: "1px solid #F1F3F5", whiteSpace: "nowrap" };
const btn = { display: "inline-block", background: "#BFFC00", color: "#0A0A0A", fontWeight: 800, padding: "10px 18px", borderRadius: 10, textDecoration: "none" };
const inp = { width: 110, padding: "8px 10px", border: "1.5px solid #E5E7EB", borderRadius: 9, fontSize: 14, fontFamily: "inherit", background: "#FAFAFA", outline: "none", boxSizing: "border-box" };
const pageBtn = { padding: "8px 14px", border: "1.5px solid #E5E7EB", borderRadius: 9, background: "#fff", fontWeight: 600, fontSize: 13, color: "#374151", cursor: "pointer", fontFamily: "inherit" };
const applyBtn = { background: "#BFFC00", color: "#0A0A0A", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em", fontSize: 13, border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontFamily: "inherit" };

function badge(m) {
  return { background: m.bg, color: m.fg, padding: "3px 10px", borderRadius: 99, fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" };
}

function Ctl({ label, children }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#6B7280" }}>{label}</label>
    {children}
  </div>;
}

function Card({ n, l, c }) {
  return <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "14px 16px" }}>
    <div style={{ fontSize: 26, fontWeight: 800, color: c || "#0A0A0A" }}>{n}</div>
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#6B7280" }}>{l}</div>
  </div>;
}

function Shell({ children, sub }) {
  return <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px 60px" }}>
    <div style={{ marginBottom: 16 }}>
      <span style={{ fontWeight: 900, fontSize: 22 }}>Inventory Planner</span>
      {sub && <span style={{ color: "#6B7280", marginLeft: 10, fontSize: 13 }}>{sub}</span>}
    </div>
    {children}
  </main>;
}
