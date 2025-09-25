// routes/adminPublicSites.js
const express = require("express");
const admin = require("firebase-admin");
const router = express.Router();
const db = admin.firestore();

// Sanea undefined (Firestore ignora undefined pero mejor normalizar)
function stripUndefinedDeep(o) {
  if (o === undefined) return null;
  if (o === null || typeof o !== "object") return o;
  if (Array.isArray(o)) return o.map(stripUndefinedDeep);
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    out[k] = stripUndefinedDeep(v);
  }
  return out;
}

// GET: devuelve companies/{tenant}.publicSite con defaults ligeros si no existe
router.get("/:tenant", async (req, res) => {
  try {
    const ref = db.doc(`companies/${req.params.tenant}`);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "tenant_not_found" });

    const c = snap.data() || {};
    const site = c.publicSite || {
      version: 1,
      template: c.mode === "services" ? "services" : "shop",
      brand: {
        name: c.name || req.params.tenant,
        logoUrl: "",
        primaryColor: "#1f7a8c",
        secondaryColor: "#14535f",
      },
      hero: { title: c.name || req.params.tenant, subtitle: "", bgUrl: "" },
      nav: { phone: "", whatsapp: "", email: "", address: "", instagram: "", facebook: "", tiktok: "", mapsLink: "" },
      sections: {
        products: { title: "Productos", enabled: true, limit: 12 },
        gallery:  { title: "Galería",  enabled: true, limit: 12 },
      },
      commerce: { checkoutMode: "whatsapp", whatsappNumber: "" },
      seo: { title: c.name || req.params.tenant, description: "", ogImageUrl: "" },
      domaining: { subdomain: c.slug || req.params.tenant, pathAlias: c.slug || req.params.tenant, customDomain: "", customDomainStatus: "pending" },
      status: "draft",
    };

    res.json(site);
  } catch (e) {
    console.error("adminPublicSites:get", e);
    res.status(500).json({ error: "internal" });
  }
});

// PUT: guarda el objeto publicSite normalizado en companies/{tenant}
router.put("/:tenant", async (req, res) => {
  try {
    const payload = stripUndefinedDeep(req.body || {});
    await db.doc(`companies/${req.params.tenant}`).set({ publicSite: payload }, { merge: true });
    res.json(payload);
  } catch (e) {
    console.error("adminPublicSites:put", e);
    res.status(500).json({ error: "internal" });
  }
});

module.exports = router;
