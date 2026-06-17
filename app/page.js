"use client";
import { useState } from "react";

export default function Home() {
  const [shop, setShop] = useState("");
  const clean = shop.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const valid = /\.myshopify\.com$/.test(clean) || /^[a-z0-9-]+$/.test(clean);
  const href = clean
    ? `/api/auth?shop=${encodeURIComponent(clean.includes(".") ? clean : clean + ".myshopify.com")}`
    : "#";

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 2px 24px rgba(0,0,0,0.08)", padding: "32px 28px", maxWidth: 460, width: "100%" }}>
        <div style={{ display: "inline-block", background: "var(--lime)", color: "var(--black)", fontWeight: 700, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", padding: "5px 12px", borderRadius: 99, marginBottom: 14 }}>
          Inventory Planner
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 900, margin: "0 0 10px", letterSpacing: "-0.5px" }}>
          Never run out of stock again
        </h1>
        <p style={{ color: "var(--gray)", fontSize: 15, lineHeight: 1.6, margin: "0 0 22px" }}>
          Connect your Shopify store and get automated reorder recommendations — how much to restock for every product — delivered to your inbox on your schedule.
        </p>

        <label style={{ display: "block", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--gray)", marginBottom: 5 }}>
          Your Shopify store
        </label>
        <input
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          placeholder="your-store.myshopify.com"
          style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #E5E7EB", borderRadius: 10, fontSize: 14, fontFamily: "inherit", background: "#FAFAFA", outline: "none", boxSizing: "border-box" }}
        />

        <a
          href={valid ? href : "#"}
          aria-disabled={!valid}
          style={{
            display: "block", textAlign: "center", marginTop: 16, padding: "14px 0",
            background: valid ? "var(--lime)" : "#E5E7EB", color: valid ? "var(--black)" : "var(--gray)",
            fontWeight: 800, fontSize: 15, letterSpacing: ".05em", textTransform: "uppercase",
            borderRadius: 12, textDecoration: "none", pointerEvents: valid ? "auto" : "none",
          }}
        >
          Connect Shopify
        </a>
        <p style={{ color: "#9CA3AF", fontSize: 12, textAlign: "center", margin: "12px 0 0" }}>
          Read-only access · by Boko Digital Solutions
        </p>
      </div>
    </main>
  );
}
