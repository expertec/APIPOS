// server/routes/kpis.js
const express = require("express");
const admin = require("firebase-admin");
const router = express.Router();
const db = admin.firestore();

router.get("/summary", async (req, res) => {
  try {
    const { tenant } = req.query;
    if (!tenant) return res.status(400).json({ error: "Missing tenant" });

    const ref = db.collection("companies").doc(tenant).collection("kpis").doc("summary");
    const snap = await ref.get();
    res.json(snap.exists ? snap.data() : {});
  } catch (e) {
    console.error("kpis:summary", e);
    res.status(500).json({ error: "internal_error" });
  }
});

router.get("/daily", async (req, res) => {
  try {
    const { tenant, days = 30 } = req.query;
    if (!tenant) return res.status(400).json({ error: "Missing tenant" });

    const since = new Date(Date.now() - Number(days)*24*60*60*1000).toISOString().slice(0,10);
    const base = db.collection("companies").doc(tenant).collection("kpis").collection("daily");
    const q = await base.get();
    const rows = q.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(r => r.id >= since)
      .sort((a,b) => (a.id < b.id ? -1 : 1));
    res.json(rows);
  } catch (e) {
    console.error("kpis:daily", e);
    res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
