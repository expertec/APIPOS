// routes/companies.js
const express = require("express");
const admin = require("firebase-admin");
const { verifyFirebaseIdToken } = require("../middleware/auth");

const router = express.Router();

// Aplica el middleware a todo este router
router.use(verifyFirebaseIdToken);

/**
 * Arma un snapshot del plan desde /plans/{planId}
 * Guarda entitlements “congelados” en el doc de la compañía.
 */
async function buildPlanSnapshot(planId = "base") {
  const db = admin.firestore();
  const planRef = db.collection("plans").doc(planId);
  const snap = await planRef.get();
  if (!snap.exists) throw new Error(`Plan ${planId} no existe en /plans`);

  const p = snap.data();

  return {
    planId,
    planRef, // Reference real (Firestore la almacena como Reference)
    status: "active",
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    // priceLocked se setea cuando haya cobro; aquí no hace falta
    entitlements: {
      agentsMax: p.limits.agentsMax,
      productsMax: p.limits.productsMax,           // -1 = ilimitado
      whatsappNumbersMax: p.limits.whatsappNumbersMax,
      automationsMax: p.limits.automationsMax,
      paymentsOnline: p.limits.paymentsOnline,
      website: p.limits.website,                    // "basic"|"editable"|"unlimited"
      crm: p.limits.crm,                            // "view"|"full"|"full+export"
      brandingRemoved: !!p.features.brandingRemoved,
      support: p.features.support,                  // "faq"|"email"|"priority"
    },
  };
}

/**
 * POST /api/admin/companies
 * body: { name, slug }
 * Crea companies/{slug} con plan base + miembro owner
 */
router.post("/", async (req, res) => {
  try {
    const { uid, email } = req.user; // viene del middleware
    const { name, slug } = req.body || {};
    if (!name || !slug) return res.status(400).json({ error: "name y slug requeridos" });

    const db = admin.firestore();
    const companyRef = db.collection("companies").doc(String(slug).toLowerCase());
    const exists = await companyRef.get();
    if (exists.exists) return res.status(409).json({ error: "slug en uso" });

    const plan = await buildPlanSnapshot("base");

    await companyRef.set({
      name,
      slug: String(slug).toLowerCase(),
      ownerUid: uid,
      ownerEmail: email || null,
      status: "active",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      setupCompleted: false, // se marca true al terminar onboarding
      plan,                  // ⬅️ snapshot efectivo
      // flags generales (puedes dejarlos o migrarlos luego)
      modules: { catalog: true, crm: true, reservations: true, automation: true, settings: true },
    });

    await companyRef.collection("members").doc(uid).set({
      role: "owner",
      email: email || null,
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "active",
    });

    res.json({ ok: true, tenantId: companyRef.id });
  } catch (e) {
    console.error("Error creando empresa:", e);
    res.status(500).json({ error: e.message || "Error creando empresa" });
  }
});

/**
 * POST /api/admin/companies/:tenantId/complete-onboarding
 * Marca setupCompleted = true
 */
router.post("/:tenantId/complete-onboarding", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const db = admin.firestore();
    await db.collection("companies").doc(tenantId).set(
      { setupCompleted: true },
      { merge: true }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("Error complete-onboarding:", e);
    res.status(500).json({ error: e.message || "Error" });
  }
});

module.exports = router;
