// Builds reorder recommendations for a shop from live Shopify data.
import { adminGraphQL } from "@/lib/shopify";
import { decrypt } from "@/lib/crypto";
import { analyse, summarise } from "@/lib/reorder";

async function fetchInventory(shop, token) {
  const variants = {}; // variantGID -> { title, variant, sku, stock, unitsSold }
  let cursor = null, pages = 0;
  const q = `query($cursor:String){
    products(first:100, after:$cursor){
      pageInfo{ hasNextPage endCursor }
      edges{ node{ title variants(first:100){ edges{ node{ id title sku inventoryQuantity } } } } }
    }
  }`;
  do {
    const data = await adminGraphQL(shop, token, q, { cursor });
    const conn = data.products;
    for (const pe of conn.edges) {
      const ptitle = pe.node.title;
      for (const ve of pe.node.variants.edges) {
        const v = ve.node;
        variants[v.id] = {
          title: ptitle,
          variant: v.title === "Default Title" ? "" : (v.title || ""),
          sku: v.sku || "",
          stock: Math.max(0, v.inventoryQuantity ?? 0),
          unitsSold: 0,
        };
      }
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    pages++;
  } while (cursor && pages < 25);
  return variants;
}

async function addSales(shop, token, variants, lookbackDays) {
  const since = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const filter = `created_at:>=${since}`;
  let cursor = null, pages = 0;
  const q = `query($cursor:String,$query:String){
    orders(first:50, after:$cursor, query:$query){
      pageInfo{ hasNextPage endCursor }
      edges{ node{ lineItems(first:100){ edges{ node{ quantity variant{ id title product{ title } } } } } } }
    }
  }`;
  do {
    const data = await adminGraphQL(shop, token, q, { cursor, query: filter });
    const conn = data.orders;
    for (const oe of conn.edges) {
      for (const le of oe.node.lineItems.edges) {
        const li = le.node;
        const vid = li.variant && li.variant.id;
        if (!vid) continue;
        if (!variants[vid]) {
          variants[vid] = {
            title: (li.variant.product && li.variant.product.title) || "Unknown product",
            variant: li.variant.title === "Default Title" ? "" : (li.variant.title || ""),
            sku: "", stock: 0, unitsSold: 0,
          };
        }
        variants[vid].unitsSold += li.quantity || 0;
      }
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    pages++;
  } while (cursor && pages < 60);
}

export async function buildReorder(shopRow, settings) {
  const token = decrypt(shopRow.accessToken);
  const params = {
    lookbackDays: settings.lookbackDays ?? 30,
    leadTimeDays: settings.leadTimeDays ?? 14,
    targetCoverDays: settings.targetCoverDays ?? 30,
  };
  const variants = await fetchInventory(shopRow.shopDomain, token);
  await addSales(shopRow.shopDomain, token, variants, params.lookbackDays);
  const items = analyse(Object.values(variants), params);
  return { items, summary: summarise(items), params };
}
