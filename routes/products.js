// server/routes/products.js
const express = require("express");
const admin = require("firebase-admin");
const { verifyFirebaseIdToken } = require("../middleware/auth");

const router = express.Router();
router.use(verifyFirebaseIdToken);

const db = () => admin.firestore();
const now = () => admin.firestore.FieldValue.serverTimestamp();

/* -------------------- helpers -------------------- */

async function getEntitlements(tenant) {
  const snap = await db().collection("companies").doc(tenant).get();
  return snap.data()?.plan?.entitlements || {};
}

async function countProducts(tenant) {
  const col = db().collection("companies").doc(tenant).collection("products");
  if (typeof col.count === "function") {
    const snap = await col.count().get();
    return snap.data().count || 0;
  }
  // Fallback si la versión del Admin SDK no soporta .count()
  const snap = await col.select().get();
  return snap.size;
}

function numOrNull(v) {
  return v != null ? Number(v) : null;
}

/** Convierte cualquier `undefined` en `null` y limpia objetos/arrays recursivamente */
function stripUndefinedDeep(o) {
  if (Array.isArray(o)) return o.map(stripUndefinedDeep);
  if (o && typeof o === "object") {
    const out = {};
    for (const k of Object.keys(o)) {
      const v = stripUndefinedDeep(o[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return o === undefined ? null : o;
}

function normalizeProductInput(input = {}) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("name required");

  const slug = String(input.slug || name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const price = {
    regularCents: Number(input.price?.regularCents ?? input.priceCents ?? 0),
    saleCents: input.price?.saleCents != null ? Number(input.price.saleCents) : null,
    onSale: !!input.price?.onSale,
    saleStartAt: input.price?.saleStartAt ?? null,
    saleEndAt: input.price?.saleEndAt ?? null,
    currency: input.price?.currency || "MXN",
    taxClass: input.price?.taxClass || "standard",
  };

  const stock = {
    manage: !!input.stock?.manage,
    qty: input.stock?.qty != null ? Number(input.stock.qty) : null,
    backorders: input.stock?.backorders || "no",
    lowStockThreshold:
      input.stock?.lowStockThreshold != null
        ? Number(input.stock.lowStockThreshold)
        : null,
  };

  // ✅ Nunca undefined: si no viene shipping, guardamos null
  const shipping = input.shipping
    ? {
        weightGrams: numOrNull(input.shipping.weightGrams),
        widthCm:     numOrNull(input.shipping.widthCm),
        heightCm:    numOrNull(input.shipping.heightCm),
        lengthCm:    numOrNull(input.shipping.lengthCm),
      }
    : null;

  const images = Array.isArray(input.images)
    ? input.images
        .filter(Boolean)
        .map((x) => ({ url: String(x.url), alt: x.alt ? String(x.alt) : undefined }))
    : [];

  const shortDescription = String(input.shortDescription || "").slice(0, 280);
  const descriptionHtml = String(input.descriptionHtml || "");
  const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];
  const categoryIds = Array.isArray(input.categoryIds) ? input.categoryIds.map(String) : [];

  return {
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
    shipping, // ← null u objeto sin undefineds

    images,
    media: { coverUrl: images[0]?.url || null }, // compat

    attributes: input.attributes || [],
    variationsCount: Number(input.variationsCount || 0),
    seo: input.seo || {},

    nameKeywords: name.toLowerCase().split(/\s+/).filter(Boolean),
  };
}

/* -------------------- LIST -------------------- */
router.get("/", async (req, res) => {
  try {
    const { tenant, q = "", limit = 20, cursor } = req.query;
    if (!tenant) return res.status(400).json({ error: "Missing tenant" });

    const col = db().collection("companies").doc(tenant).collection("products");

    let ref;
    if (q) {
      // búsqueda simple por keywords
      ref = col
        .where("nameKeywords", "array-contains", String(q).toLowerCase())
        .limit(Number(limit));
    } else {
      ref = col.orderBy("name").limit(Number(limit));
      if (cursor) {
        const cur = await col.doc(String(cursor)).get();
        if (cur.exists) ref = ref.startAfter(cur);
      }
    }

    const snap = await ref.get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const nextCursor = !q && snap.docs.length ? snap.docs[snap.docs.length - 1].id : null;

    res.json({ items, nextCursor });
  } catch (e) {
    console.error("products:list", e);
    res.status(500).json({ error: "internal_error" });
  }
});

/* -------------------- CREATE -------------------- */
router.post("/", async (req, res) => {
  try {
    const { tenant, product } = req.body || {};
    if (!tenant || !product) {
      return res.status(400).json({ error: "Missing tenant/product" });
    }

    // Límite de plan
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

    let data;
    try {
      data = normalizeProductInput(product);
    } catch (e) {
      console.error("[products:create] normalize error:", e);
      return res.status(400).json({ error: "bad_input", message: String(e?.message || e) });
    }

    data = stripUndefinedDeep(data); // 🔒 limpieza final anti-undefined

    const ref = db().collection("companies").doc(tenant).collection("products").doc();
    await ref.set({ ...data, createdAt: now(), updatedAt: now() });

    const fresh = await ref.get();
    res.json({ id: ref.id, ...fresh.data() });
  } catch (e) {
    console.error("products:create", e);
    res.status(500).json({ error: e.message || "internal_error" });
  }
});

/* -------------------- UPDATE -------------------- */
router.put("/:id", async (req, res) => {
  try {
    const { tenant, updates } = req.body || {};
    const { id } = req.params;
    if (!tenant || !id) return res.status(400).json({ error: "Missing tenant/id" });

    const toSet = {};
    if (updates) {
      const partial = normalizeProductInput({
        ...updates,
        name: updates.name ?? "placeholder",
      });

      // Solo llevamos los campos que vinieron en `updates`
      Object.keys(partial).forEach((k) => {
        if (updates[k] !== undefined) toSet[k] = partial[k];
      });

      // Recalcular nameKeywords/slug si cambió name/slug
      if (updates.name != null || updates.slug != null) {
        const n = String(updates.name ?? partial.name);
        toSet.nameKeywords = n.toLowerCase().split(/\s+/).filter(Boolean);
        toSet.slug = partial.slug;
      }
    }

    toSet.updatedAt = now();

    const ref = db().collection("companies").doc(tenant).collection("products").doc(id);
    await ref.set(stripUndefinedDeep(toSet), { merge: true });

    const fresh = await ref.get();
    res.json({ id, ...fresh.data() });
  } catch (e) {
    console.error("products:update", e);
    res.status(500).json({ error: e.message || "internal_error" });
  }
});

/* -------------------- DELETE -------------------- */
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
