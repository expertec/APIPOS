// server/routes/products.js
const express = require("express");
const admin = require("firebase-admin");
const { verifyFirebaseIdToken } = require("../middleware/auth");

const router = express.Router();
router.use(verifyFirebaseIdToken);

const db = () => admin.firestore();
const now = () => admin.firestore.FieldValue.serverTimestamp();
const inc = admin.firestore.FieldValue.increment;

async function getEntitlements(tenant) {
  const snap = await db().collection("companies").doc(tenant).get();
  return snap.data()?.plan?.entitlements || {};
}
async function countProducts(tenant) {
  const snap = await db().collection("companies").doc(tenant).collection("products").count().get();
  return snap.data().count || 0;
}

function normalizeProductInput(input) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("name required");

  const slug = String(input.slug || name)
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const price = {
    regularCents: Number(input.price?.regularCents ?? input.priceCents ?? 0),
    saleCents: input.price?.saleCents != null ? Number(input.price.saleCents) : null,
    onSale: !!input.price?.onSale,
    saleStartAt: input.price?.saleStartAt || null,
    saleEndAt: input.price?.saleEndAt || null,
    currency: input.price?.currency || "MXN",
    taxClass: input.price?.taxClass || "standard",
  };

  const stock = {
    manage: !!input.stock?.manage,
    qty: input.stock?.qty != null ? Number(input.stock.qty) : null,
    backorders: input.stock?.backorders || "no",
    lowStockThreshold: input.stock?.lowStockThreshold != null ? Number(input.stock.lowStockThreshold) : null,
  };

  const shipping = input.shipping ? {
    weightGrams: numOrNull(input.shipping.weightGrams),
    widthCm: numOrNull(input.shipping.widthCm),
    heightCm: numOrNull(input.shipping.heightCm),
    lengthCm: numOrNull(input.shipping.lengthCm),
  } : undefined;

  const images = Array.isArray(input.images) ? input.images
    .filter(Boolean)
    .map(x => ({ url: String(x.url), alt: x.alt ? String(x.alt) : undefined })) : [];

  const shortDescription = String(input.shortDescription || "").slice(0, 280);
  const descriptionHtml = String(input.descriptionHtml || "");
  const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];
  const categoryIds = Array.isArray(input.categoryIds) ? input.categoryIds.map(String) : [];

  const base = {
    name,
    slug,
    sku: input.sku || null,
    status: input.status || "draft",
    visibility: input.visibility || "catalog",
    type: input.type || "simple",
    price,
    shortDescription,
    descriptionHtml,
    tags,
    categoryIds,
    stock,
    shipping,
    images,
    media: { coverUrl: images[0]?.url }, // compat
    attributes: input.attributes || [],
    variationsCount: Number(input.variationsCount || 0),
    seo: input.seo || {},
    nameKeywords: name.toLowerCase().split(/\s+/).filter(Boolean),
  };

  return base;
}

function numOrNull(v){ return v!=null ? Number(v) : null; }

// LIST
router.get("/", async (req, res) => {
  try {
    const { tenant, q = "", limit = 20, cursor } = req.query;
    if (!tenant) return res.status(400).json({ error: "Missing tenant" });

    const col = db().collection("companies").doc(tenant).collection("products");
    let ref = col.orderBy("name").limit(Number(limit));
    if (q) ref = col.where("nameKeywords", "array-contains", String(q).toLowerCase()).limit(Number(limit));
    if (cursor) {
      const cur = await col.doc(String(cursor)).get();
      if (cur.exists) ref = ref.startAfter(cur);
    }
    const snap = await ref.get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const nextCursor = snap.docs.length ? snap.docs[snap.docs.length - 1].id : null;
    res.json({ items, nextCursor });
  } catch (e) {
    console.error("products:list", e);
    res.status(500).json({ error: "internal_error" });
  }
});

// CREATE
router.post("/", async (req, res) => {
  try {
    const { tenant, product } = req.body || {};
    if (!tenant || !product) return res.status(400).json({ error: "Missing tenant/product" });

    // plan limit
    const ents = await getEntitlements(tenant);
    const max = Number(ents.productsMax ?? 0);
    if (max > 0) {
      const count = await countProducts(tenant);
      if (count >= max) {
        return res.status(402).json({
          error: "limit_reached",
          feature: "products",
          entitlement: "productsMax",
          max,
          current: count,
          message: "Products limit reached for current plan",
        });
      }
    }

    const data = normalizeProductInput(product);
    const ref = db().collection("companies").doc(tenant).collection("products").doc();
    await ref.set({ ...data, createdAt: now(), updatedAt: now() });
    const fresh = await ref.get();
    res.json({ id: ref.id, ...fresh.data() });
  } catch (e) {
    console.error("products:create", e);
    res.status(500).json({ error: e.message || "internal_error" });
  }
});

// UPDATE
router.put("/:id", async (req, res) => {
  try {
    const { tenant, updates } = req.body || {};
    const { id } = req.params;
    if (!tenant || !id) return res.status(400).json({ error: "Missing tenant/id" });

    const toSet = {};
    if (updates) {
      const partial = normalizeProductInput({ ...updates, name: updates.name ?? "placeholder" });
      // quitamos campos que no se actualizaron explícitamente
      Object.keys(partial).forEach(k => {
        if (updates[k] !== undefined) toSet[k] = partial[k];
      });
      // nameKeywords/slug si cambió name/slug
      if (updates.name != null || updates.slug != null) {
        const n = String(updates.name ?? partial.name);
        toSet.nameKeywords = n.toLowerCase().split(/\s+/).filter(Boolean);
        toSet.slug = partial.slug;
      }
    }
    toSet.updatedAt = now();
    const ref = db().collection("companies").doc(tenant).collection("products").doc(id);
    await ref.set(toSet, { merge: true });
    const fresh = await ref.get();
    res.json({ id, ...fresh.data() });
  } catch (e) {
    console.error("products:update", e);
    res.status(500).json({ error: e.message || "internal_error" });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  try {
    const { tenant } = req.body || {};
    const { id } = req.params;
    if (!tenant || !id) return res.status(400).json({ error: "Missing tenant/id" });
    await db().collection("companies").doc(tenant).collection("products").doc(id).delete();
    res.json({ ok: true });
  } catch (e) {
    console.error("products:delete", e);
    res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
