// routes/adminGallery.js
const express = require("express");
const admin = require("firebase-admin");
const router = express.Router();
const db = admin.firestore();

router.get("/:tenant", async (req, res) => {
  const qs = await db.collection(`companies/${req.params.tenant}/gallery`)
    .orderBy("sort","asc").get();
  res.json({ items: qs.docs.map(d=>({ id:d.id, ...d.data() })) });
});

router.post("/:tenant", async (req, res) => {
  const { url, alt, sort } = req.body || {};
  if (!url) return res.status(400).json({ error: "url_required" });
  const now = Date.now();
  const ref = await db.collection(`companies/${req.params.tenant}/gallery`).add({
    url, alt: alt || "", sort: typeof sort === "number" ? sort : now, createdAt: now
  });
  res.json({ id: ref.id });
});

router.put("/:tenant/:id", async (req, res) => {
  const patch = {};
  if (typeof req.body?.alt === "string") patch.alt = req.body.alt;
  if (typeof req.body?.sort === "number") patch.sort = req.body.sort;
  if (!Object.keys(patch).length) return res.status(400).json({ error: "nothing_to_update" });
  await db.doc(`companies/${req.params.tenant}/gallery/${req.params.id}`).set(patch, { merge: true });
  res.json({ ok: true });
});

router.delete("/:tenant/:id", async (req, res) => {
  await db.doc(`companies/${req.params.tenant}/gallery/${req.params.id}`).delete();
  res.json({ ok: true });
});

module.exports = router;
