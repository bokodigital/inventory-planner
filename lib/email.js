// Renders and sends the restock digest email via Resend (one app-owned sender).
import { Resend } from "resend";
import { byUrgency } from "@/lib/reorder";

function rows(items) {
  return byUrgency(items).map((i) => {
    const cover = i.daysCover === Infinity ? "∞" : Math.round(i.daysCover);
    const name = i.variant ? `${i.title} — ${i.variant}` : i.title;
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(name)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${i.stock}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${cover}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${i.reorderQty}</td>
    </tr>`;
  }).join("");
}
function esc(s){ return String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }

export function renderDigestHtml(shopName, data) {
  const { summary, params } = data;
  const head = `<tr style="background:#fafbfc">
    <th align="left" style="padding:6px 10px;font-size:11px;color:#6b7280;text-transform:uppercase">Product</th>
    <th align="right" style="padding:6px 10px;font-size:11px;color:#6b7280;text-transform:uppercase">In stock</th>
    <th align="right" style="padding:6px 10px;font-size:11px;color:#6b7280;text-transform:uppercase">Days cover</th>
    <th align="right" style="padding:6px 10px;font-size:11px;color:#6b7280;text-transform:uppercase">Order qty</th>
  </tr>`;
  let body;
  if (!summary.hasSales) {
    body = `<p style="color:#374151">No sales recorded in the last ${params.lookbackDays} days, so there are no reorder recommendations this period.</p>`;
  } else {
    const nowTable = summary.now.length
      ? `<h3 style="margin:18px 0 6px">🔴 Order now (${summary.now.length})</h3>
         <table style="width:100%;border-collapse:collapse;font-size:14px">${head}${rows(summary.now)}</table>` : "";
    const soonTable = summary.soon.length
      ? `<h3 style="margin:18px 0 6px">🟡 Reorder soon (${summary.soon.length})</h3>
         <table style="width:100%;border-collapse:collapse;font-size:14px">${head}${rows(summary.soon)}</table>` : "";
    const allGood = (!summary.now.length && !summary.soon.length)
      ? `<p style="color:#059669">All tracked products are healthy — nothing to reorder right now. ✅</p>` : "";
    body = `<p style="color:#374151">${summary.orderNow} to order now · ${summary.reorderSoon} to watch · ${summary.unitsToOrder.toLocaleString()} units recommended.</p>${nowTable}${soonTable}${allGood}`;
  }
  return `<div style="font-family:Poppins,Arial,sans-serif;max-width:640px;margin:0 auto;color:#0a0a0a">
    <div style="background:#0a0a0a;border-radius:12px 12px 0 0;padding:16px 20px">
      <span style="color:#fff;font-weight:800;font-size:18px">boko</span>
      <span style="color:#BFFC00;font-weight:800;font-size:18px"> inventory planner</span>
    </div>
    <div style="border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;padding:20px">
      <h2 style="margin:0 0 4px;font-size:18px">Restock digest — ${esc(shopName)}</h2>
      <p style="color:#9ca3af;font-size:12px;margin:0 0 8px">${params.lookbackDays}-day lookback · ${params.leadTimeDays}-day lead time · ${params.targetCoverDays}-day target cover</p>
      ${body}
      <p style="color:#9ca3af;font-size:12px;margin-top:20px">Advisory only — review before ordering. Sent by Boko Inventory Planner.</p>
    </div>
  </div>`;
}

export async function sendDigest(toEmail, shopName, data) {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const dateStr = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  const flagged = data.summary.orderNow;
  const subject = data.summary.hasSales
    ? `Restock digest — ${flagged} to order now (${dateStr})`
    : `Restock digest — no action needed (${dateStr})`;
  const { data: res, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: toEmail,
    subject,
    html: renderDigestHtml(shopName, data),
  });
  if (error) throw new Error(error.message || JSON.stringify(error));
  return res && res.id;
}
