// server/routes/categories.js
const express = require("express");
const admin = require("firebase-admin");
const { verifyFirebaseIdToken } = require("../middleware/auth");

const router = express.Router();
router.use(verifyFirebaseIdToken);

const db = () => admin.firestore();
const now = () => admin.firestore.FieldValue.serverTimestamp();

/* -------------------- utils -------------------- */
function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Convierte undefined->null y limpia recursivamente (Firestore no acepta undefined) */
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

/* -------------------- GET /api/admin/categories?tenant=... -------------------- */
router.get("/", async (req, res) => {
  try {
    const { tenant } = req.query;
    if (!tenant) return res.status(400).json({ error: "Missing tenant" });

    const col = db().collection("companies").doc(tenant).collection("categories");

    let snap;
    try {
      // preferimos ordenar por sort (position). Si falla (p.ej. índice raro), caemos a sin orden.
      snap = await col.orderBy("sort").get();
    } catch (e) {
      console.warn("[categories:list] orderBy(sort) falló, usando sin orden:", e?.message || e);
      snap = await col.get();
    }

    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json({ items });
  } catch (e) {
    console.error("categories:list", e);
    return res.status(500).json({ error: "internal_error" });
  }
});

/* -------------------- POST /api/admin/categories -------------------- */
/* Body esperado: { tenant, category: { name, parentId?, color?, position? } } */
router.post("/", async (req, res) => {
  try {
    const { tenant, category } = req.body || {};
    if (!tenant || !category || !category.name) {
      return res.status(400).json({ error: "Missing tenant/category.name" });
    }

    const name = String(category.name).trim();
    const slug = slugify(name);
    const parentId = category.parentId ?? null;
    const sort = category.position != null ? Number(category.position) : Number(category.sort ?? 0);
    const color = category.color ?? null;

    // path jerárquico
    let pathArr = [slug];
    if (parentId) {
      const p = await db().collection("companies").doc(tenant).collection("categories").doc(parentId).get();
      if (!p.exists) return res.status(400).json({ error: "parent_not_found" });
      pathArr = [ ...(p.data().path || []), slug ];
    }

    const data = stripUndefinedDeep({
      name,
      slug,
      parentId,
      color,
      sort,
      position: sort,              // alias por compat
      path: pathArr,
      productCount: 0,
      createdAt: now(),
      updatedAt: now(),
    });

    const ref = db().collection("companies").doc(tenant).collection("categories").doc();
    await ref.set(data);

    const fresh = await ref.get();
    return res.json({ id: ref.id, ...fresh.data() });
  } catch (e) {
    console.error("categories:create", e);
    return res.status(500).json({ error: e.message || "internal_error" });
  }
});

/* -------------------- PUT /api/admin/categories/:id -------------------- */
/* Body esperado: { tenant, updates: { name?, parentId?, color?, position?/sort? } } */
router.put("/:id", async (req, res) => {
  try {
    const { tenant, updates } = req.body || {};
    const { id } = req.params;
    if (!tenant || !id) return res.status(400).json({ error: "Missing tenant/id" });

    const toSet = { updatedAt: now() };

    if (updates) {
      if (updates.name != null) {
        toSet.name = String(updates.name).trim();
        toSet.slug = slugify(toSet.name);
      }
      if (updates.parentId !== undefined) {
        toSet.parentId = updates.parentId || null;
      }
      if (updates.color !== undefined) toSet.color = updates.color ?? null;

      // position/sort alias
      if (updates.position != null) toSet.sort = Number(updates.position);
      if (updates.sort != null) toSet.sort = Number(updates.sort);

      // recomputar path si cambió el nombre o el parentId
      if (toSet.name != null || updates.parentId !== undefined) {
        const ownSlug = slugify(toSet.name ?? updates.name ?? "");
        let pathArr = [ownSlug];

        const parentId = updates.parentId !== undefined ? updates.parentId : undefined;
        if (parentId) {
          const p = await db().collection("companies").doc(tenant).collection("categories").doc(parentId).get();
          if (!p.exists) return res.status(400).json({ error: "parent_not_found" });
          pathArr = [ ...(p.data().path || []), ownSlug ];
        }
        toSet.path = pathArr;
      }
    }

    const ref = db().collection("companies").doc(tenant).collection("categories").doc(id);
    await ref.set(stripUndefinedDeep(toSet), { merge: true });
    const fresh = await ref.get();
    return res.json({ id, ...fresh.data() });
  } catch (e) {
    console.error("categories:update", e);
    return res.status(500).json({ error: e.message || "internal_error" });
  }
});

/* -------------------- DELETE /api/admin/categories/:id -------------------- */
/* Body: { tenant } */
router.delete("/:id", async (req, res) => {
  try {
    const { tenant } = req.body || {};
    const { id } = req.params;
    if (!tenant || !id) return res.status(400).json({ error: "Missing tenant/id" });

    // (opcional) validar que no tenga hijas o productos antes de borrar
    await db().collection("companies").doc(tenant).collection("categories").doc(id).delete();
    return res.json({ ok: true });
  } catch (e) {
    console.error("categories:delete", e);
    return res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
