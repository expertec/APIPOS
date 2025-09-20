// server/routes/plans.js
const express = require("express");
const admin = require("firebase-admin");
const { verifyFirebaseIdToken } = require("../middleware/auth");

const router = express.Router();
router.use(verifyFirebaseIdToken);

router.get("/", async (_req, res) => {
  try {
    const snap = await admin.firestore().collection("plans").orderBy("sort", "asc").get().catch(async () => {
      // si no hay 'sort', devuélvelos como estén
      return await admin.firestore().collection("plans").get();
    });
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ error: e.message || "Error leyendo planes" });
  }
});

module.exports = router;
