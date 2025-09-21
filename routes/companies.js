// routes/companies.js (versión extendida)
const express = require("express");
const admin = require("firebase-admin");
const { verifyFirebaseIdToken } = require("../middleware/auth");
const { seedKpisForTenant } = require("../lib/kpisSeed");
const router = express.Router();
router.use(verifyFirebaseIdToken);

async function buildPlanSnapshot(planId = "base") {
  const db = admin.firestore();
  const planRef = db.collection("plans").doc(planId);
  const snap = await planRef.get();
  if (!snap.exists) throw new Error(`Plan ${planId} no existe`);
  const p = snap.data();
  return {
    planId,
    planRef: planRef.path,
    status: "active",
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    entitlements: {
      agentsMax: p.limits.agentsMax,
      productsMax: p.limits.productsMax,
      whatsappNumbersMax: p.limits.whatsappNumbersMax,
      automationsMax: p.limits.automationsMax,
      paymentsOnline: p.limits.paymentsOnline,
      website: p.limits.website,
      crm: p.limits.crm,
      brandingRemoved: !!p.features.brandingRemoved,
      support: p.features.support,
    },
    priceLocked: null, // lo setearás cuando Stripe confirme
  };
}

// POST /api/admin/companies
router.post("/", async (req, res) => {
  try {
    const { uid, email } = req.user;
    const { name, slug, industry = "retail", mode = "products" } = req.body || {};
    if (!name || !slug) return res.status(400).json({ error: "name y slug requeridos" });

    const db = admin.firestore();
    const slugId = String(slug).toLowerCase();
    const companyRef = db.collection("companies").doc(slugId);

    // 1) Reserva de slug (si existe, 409)
    const slugRef = db.collection("company_slugs").doc(slugId);
    const slugSnap = await slugRef.get();
    if (slugSnap.exists) return res.status(409).json({ error: "slug en uso" });
    await slugRef.set({
      ownerUid: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 2) Plan base
    const plan = await buildPlanSnapshot("base");

    // 3) Módulos derivados del modo
    const modules = {
      catalog: true,
      crm: true,
      reservations: mode === "services",
      automation: true,
      settings: true,
    };
await seedKpisForTenant(slugId);
    // 4) Crea compañía
    await companyRef.set({
      name,
      slug: slugId,
      industry,
      mode,
      ownerUid: uid,
      ownerEmail: email || null,
      status: "active",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      setupCompleted: false,
      plan,
      modules,
    });

    // 5) Miembro owner
    await companyRef.collection("members").doc(uid).set({
      uid,
      email: email || null,
      role: "owner",
      status: "active",
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ ok: true, tenantId: slugId });
  } catch (e) {
    console.error("companies:create", e);
    res.status(500).json({ error: e.message || "Error creando empresa" });
  }
});

// POST /api/admin/companies/:tenantId/complete-onboarding
router.post("/:tenantId/complete-onboarding", async (req, res) => {
  try {
    const { tenantId } = req.params;
    await admin.firestore().collection("companies").doc(tenantId).set(
      { setupCompleted: true },
      { merge: true }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("companies:complete-onboarding", e);
    res.status(500).json({ error: e.message || "Error" });
  }
});

module.exports = router;
