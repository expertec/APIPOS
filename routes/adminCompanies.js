// routes/adminCompanies.js
const express = require("express");
const admin = require("firebase-admin");
const { FieldValue } = admin.firestore;

const router = express.Router();
const db = admin.firestore();

/** Defaults por giro/modo */
function computeDefaultsForGiro({ name, slug, mode = "products", industry }) {
  const base = {
    version: 1,
    template: "shop",
    brand: { name, logoUrl: "", primaryColor: "#1f7a8c", secondaryColor: "#14535f" },
    hero: { title: name, subtitle: "", bgUrl: "" },
    nav: { phone: "", whatsapp: "", email: "", address: "", instagram: "", facebook: "", tiktok: "", mapsLink: "" },
    sections: {
      products:    { title: "Productos",    enabled: true,  categoryId: null, limit: 12, layout: "grid" },
      services:    { title: "Servicios",    enabled: false, categoryId: null, limit: 12, layout: "grid" },
      menu:        { title: "Menú",         enabled: false, categoryId: null, limit: 24, layout: "list" },
      rooms:       { title: "Habitaciones", enabled: false, categoryId: null, limit: 12, layout: "grid" },
      gallery:     { title: "Galería",      enabled: true,  limit: 12 }, // 👈 todos con galería
      reservations:{ enabled: false, mode: "embed" },
      testimonials:{ title: "Testimonios",  enabled: false, limit: 6 },
      about:       { title: "Sobre nosotros", enabled: false },
      ctaBar:      { enabled: false, text: "", buttonText: "", buttonLink: "" }
    },
    features: { shop: true, menu: false, reservations: false },
    commerce: { checkoutMode: "whatsapp", whatsappNumber: "" },
    seo: { title: name, description: "", ogImageUrl: "" },
    domaining: { subdomain: slug, pathAlias: slug, customDomain: "", customDomainStatus: "pending" },
    status: "draft",
    publishedAt: null,
    expiresAt: null
  };

  if ((industry || "").toLowerCase() === "restaurant") {
    base.template = "restaurant";
    base.sections.products.enabled = false;
    base.sections.menu.enabled = true;
    base.features = { shop: false, menu: true, reservations: false };
  }
  if ((industry || "").toLowerCase() === "hotel") {
    base.template = "hotel";
    base.sections.products.enabled = false;
    base.sections.rooms.enabled = true;
    base.sections.reservations.enabled = true;
    base.features = { shop: false, menu: false, reservations: true };
  }
  if (mode === "services") {
    base.template = base.template === "restaurant" || base.template === "hotel" ? base.template : "services";
    base.sections.products.enabled = false;
    base.sections.services.enabled = true;
    base.sections.reservations.enabled = true;
    base.features = { shop: false, menu: base.features.menu, reservations: true };
  }
  return base;
}

/**
 * POST /api/admin/companies
 * body: { name, slug, mode, industry, ownerUid, ownerEmail }
 */
router.post("/", async (req, res) => {
  try {
    const { name, slug, mode, industry, ownerUid, ownerEmail } = req.body || {};
    if (!name || !slug || !ownerUid) return res.status(400).json({ error: "missing_fields" });

    const slugRef = db.doc(`company_slugs/${slug}`);
    const tenantRef = db.doc(`companies/${slug}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(slugRef);
      if (snap.exists) throw new Error("slug_taken");

      tx.set(tenantRef, {
        name, slug, mode: mode || "products", industry: industry || "retail",
        planId: "base",
        createdAt: FieldValue.serverTimestamp(),
        publicSite: computeDefaultsForGiro({ name, slug, mode, industry })
      }, { merge: true });

      tx.set(slugRef, { tenantId: slug, createdAt: FieldValue.serverTimestamp() });

      tx.set(tenantRef.collection("members").doc(ownerUid), {
        uid: ownerUid, email: ownerEmail || "", role: "owner", createdAt: FieldValue.serverTimestamp()
      });
    });

    // Si es services/hotel, crea reserva por defecto
    if (mode === "services" || (industry||"").toLowerCase()==="hotel") {
      await db.doc(`companies/${slug}/reservation_settings/default`).set({
        timezone: "America/Mexico_City",
        slotMinutes: 60,
        workHours: [
          { dow: 1, from: "09:00", to: "18:00" },
          { dow: 2, from: "09:00", to: "18:00" },
          { dow: 3, from: "09:00", to: "18:00" },
          { dow: 4, from: "09:00", to: "18:00" },
          { dow: 5, from: "09:00", to: "18:00" }
        ],
        createdAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }

    return res.json({ ok: true, tenantId: slug });
  } catch (e) {
    console.error("createCompany error:", e);
    if (e && e.message === "slug_taken") return res.status(409).json({ error: "slug_taken" });
    return res.status(500).json({ error: "internal" });
  }
});

/** (Opcional) POST /api/admin/companies/:tenant/complete-onboarding */
router.post("/:tenant/complete-onboarding", async (req, res) => {
  try {
    await db.doc(`companies/${req.params.tenant}`).set({
      onboardingCompletedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal" });
  }
});

module.exports = router;
