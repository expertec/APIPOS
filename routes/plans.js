// server/routes/plans.js
const express = require("express");
const admin = require("firebase-admin");
const { verifyFirebaseIdToken } = require("../middleware/auth");

const router = express.Router();

// protege todas las rutas de este router
router.use(verifyFirebaseIdToken);

// GET /api/admin/plans
router.get("/", async (req, res) => {
  try {
    // Log útil para ver si el token llegó bien
    console.log("[plans] requester:", req.user?.uid, req.user?.email);

    const col = admin.firestore().collection("plans");

    // Evitamos posibles rarezas con orderBy si algún doc no tiene 'sort'
    const snap = await col.get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Ordenamos en memoria si hay 'sort'; si no, dejamos como viene
    items.sort((a, b) => {
      const sa = typeof a.sort === "number" ? a.sort : Number.MAX_SAFE_INTEGER;
      const sb = typeof b.sort === "number" ? b.sort : Number.MAX_SAFE_INTEGER;
      return sa - sb;
    });

    console.log("[plans] count:", items.length);
    return res.json({ ok: true, items });
  } catch (e) {
    console.error("GET /api/admin/plans error:", e);
    return res.status(500).json({ error: e?.message || "Error leyendo planes" });
  }
});

module.exports = router;
