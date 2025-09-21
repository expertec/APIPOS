const express = require("express");
const admin = require("firebase-admin");
const { verifyFirebaseIdToken } = require("../middleware/auth");

const router = express.Router();
router.use(verifyFirebaseIdToken);

// helpers
const db = () => admin.firestore();
const now = () => admin.firestore.FieldValue.serverTimestamp();

async function getEntitlements(tenant) {
  const doc = await db().collection("companies").doc(tenant).get();
  const data = doc.data() || {};
  return data?.plan?.entitlements || {};
}

async function countProducts(tenant) {
  const snap = await db().collection("companies").doc(tenant).collection("products").count().get();
  return snap.data().count || 0;
}

// GET /api/admin/products?tenant=...&q=...&limit=20&cursor=<docId>
router.get("/", async (req, res) => {
  try {
    const { tenant, q = "", limit = 20, cursor } = req.query;
    if (!tenant) return res.status(400).json({ error: "Missing tenant" });

    let ref = db().collection("companies").doc(tenant).collection("products")
      .orderBy("name").limit(Number(limit));

    if (q) ref = ref.where("nameKeywords", "array-contains", String(q).toLowerCase());
    if (cursor) {
      const cur = await db().collection("companies").doc(tenant).collection("products").doc(cursor).get();
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

// POST /api/admin/products  { tenant, product }
router.post("/", async (req, res) => {
  try {
    const { tenant, product } = req.body || {};
    if (!tenant || !product?.name || product?.priceCents == null) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // Límite de plan
    const ents = await getEntitlements(tenant);
    const max = Number(ents.productsMax ?? 0);
    if (max > 0) {
      const count = await countProducts(tenant);
      if (count >= max) {
        return res.status(402).json({ error: "products_limit_reached", max });
      }
    }

    const col = db().collection("companies").doc(tenant).collection("products");
    const doc = col.doc();
    const name = String(product.name);
    const data = {
      name,
      nameKeywords: name.toLowerCase().split(/\s+/).filter(Boolean),
      slug: (product.slug || name).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      sku: product.sku || null,
      priceCents: Number(product.priceCents),
      active: product.active ?? true,
      stock: product.stock ?? null,
      media: product.media || {},
      categoryIds: product.categoryIds || [],
      createdAt: now(),
      updatedAt: now(),
    };
    await doc.set(data);
    res.json({ id: doc.id, ...data });
  } catch (e) {
    console.error("products:create", e);
    res.status(500).json({ error: "internal_error" });
  }
});

// PUT /api/admin/products/:id  { tenant, updates }
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { tenant, updates } = req.body || {};
    if (!tenant || !id) return res.status(400).json({ error: "Missing tenant or id" });

    const ref = db().collection("companies").doc(tenant).collection("products").doc(id);
    const toSet = { ...updates, updatedAt: now() };
    if (updates?.name) {
      toSet.nameKeywords = String(updates.name).toLowerCase().split(/\s+/).filter(Boolean);
      toSet.slug = (updates.slug || updates.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }
    await ref.set(toSet, { merge: true });
    const fresh = await ref.get();
    res.json({ id, ...fresh.data() });
  } catch (e) {
    console.error("products:update", e);
    res.status(500).json({ error: "internal_error" });
  }
});

// DELETE /api/admin/products/:id  { tenant }
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { tenant } = req.body || {};
    if (!tenant || !id) return res.status(400).json({ error: "Missing tenant or id" });
    await db().collection("companies").doc(tenant).collection("products").doc(id).delete();
    res.json({ ok: true });
  } catch (e) {
    console.error("products:delete", e);
    res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
