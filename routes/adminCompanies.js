// routes/adminCompanies.js  (añade/actualiza así)
const express = require("express");
const admin = require("firebase-admin");
const { FieldValue } = admin.firestore;
const router = express.Router();
const db = admin.firestore();

function todayYMD(tz = "America/Mexico_City") {
  const d = new Date();
  // Y-M-D simple; si quieres tz real, usa luxon o moment-timezone.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function computeDefaultsForGiro({ name, slug, mode = "products", industry }) {
  const base = {
    version: 1,
    template: "shop",
    brand: { name, logoUrl: "", primaryColor: "#1f7a8c", secondaryColor: "#14535f" },
    hero: { title: name, subtitle: "", bgUrl: "" },
    nav: { phone: "", whatsapp: "", email: "", address: "", instagram: "", facebook: "", tiktok: "", mapsLink: "" },
    sections: {
      products:    { title: "Productos",    enabled: mode !== "services", categoryId: null, limit: 12, layout: "grid" },
      services:    { title: "Servicios",    enabled: mode === "services", categoryId: null, limit: 12, layout: "grid" },
      menu:        { title: "Menú",         enabled: (industry||"").toLowerCase()==="restaurant", categoryId: null, limit: 24, layout: "list" },
      rooms:       { title: "Habitaciones", enabled: (industry||"").toLowerCase()==="hotel",      categoryId: null, limit: 12, layout: "grid" },
      gallery:     { title: "Galería",      enabled: true,  limit: 12 },
      reservations:{ enabled: mode === "services" || (industry||"").toLowerCase()==="hotel", mode: "embed" },
      testimonials:{ title: "Testimonios",  enabled: false, limit: 6 },
      about:       { title: "Sobre nosotros", enabled: false },
      ctaBar:      { enabled: false, text: "", buttonText: "", buttonLink: "" }
    },
    features: { shop: mode !== "services", menu: (industry||"").toLowerCase()==="restaurant", reservations: mode === "services" || (industry||"").toLowerCase()==="hotel" },
    commerce: { checkoutMode: "whatsapp", whatsappNumber: "" },
    seo: { title: name, description: "", ogImageUrl: "" },
    domaining: { subdomain: slug, pathAlias: slug, customDomain: "", customDomainStatus: "pending" },
    status: "draft",
    publishedAt: null,
    expiresAt: null
  };
  return base;
}

/** POST /api/admin/companies */
router.post("/", async (req, res) => {
  try {
    const { name, slug, mode, industry, ownerUid, ownerEmail } = req.body || {};
    if (!name || !slug || !ownerUid) return res.status(400).json({ error: "missing_fields" });

    const slugRef = db.doc(`company_slugs/${slug}`);
    const tenantRef = db.doc(`companies/${slug}`);

    // 1) Transacción: reserva slug + crea company (root) + member owner
    await db.runTransaction(async (tx) => {
      const taken = await tx.get(slugRef);
      if (taken.exists) throw new Error("slug_taken");

      // Campos adicionales similares a tu doc viejo
      const now = FieldValue.serverTimestamp();
      const root = {
        name, slug,
        mode: mode || "products",
        industry: industry || "retail",
        planId: "base",
        status: "active",            // <— lo tenía negocio500
        setupCompleted: true,        // <— si lo usas, lo dejamos marcado
        createdAt: now,
        onboardingCompletedAt: now,
        modules: {                   // <— ejemplo; ajusta a tu realidad
          automation: true,
          catalog: true,
          crm: true,
          reservations: mode === "services"
        },
        publicSite: computeDefaultsForGiro({ name, slug, mode, industry }),
      };

      tx.set(tenantRef, root, { merge: true });
      tx.set(slugRef, { tenantId: slug, createdAt: now });
      tx.set(tenantRef.collection("members").doc(ownerUid), {
        uid: ownerUid, email: ownerEmail || "", role: "owner", createdAt: now
      });
    });

    // 2) Bootstrap post-crear (fuera de la TX)
    const isServices = mode === "services" || (industry||"").toLowerCase()==="hotel";

    // KPIs mínimos
    await db.doc(`companies/${slug}/kpis/summary`).set({
      orders: 0, revenue: 0, customers: 0, updatedAt: Date.now()
    }, { merge: true });

    await db.doc(`companies/${slug}/kpis_daily/${todayYMD()}`).set({
      orders: 0, revenue: 0, customers: 0, date: todayYMD()
    }, { merge: true });

    // Reservation settings si aplica
    if (isServices) {
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

    // Demo item/product con flags web para que el sitio no salga vacío
    if (mode === "products") {
      await db.collection(`companies/${slug}/products`).doc("demo-product").set({
        name: "Producto demo",
        sku: "PRD-DEMO",
        price: 199,
        status: "active",
        visibilityWeb: true,
        webSort: 0,
        createdAt: FieldValue.serverTimestamp()
      }, { merge: true });
    } else {
      await db.collection(`companies/${slug}/items`).doc("demo-service").set({
        type: "service",
        name: "Servicio demo",
        sku: "SRV-DEMO",
        price: 199,
        allowsBooking: true,
        status: "active",
        visibilityWeb: true,
        webSort: 0,
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

/** POST /api/admin/companies/:tenant/complete-onboarding */
router.post("/:tenant/complete-onboarding", async (req, res) => {
  try {
    await db.doc(`companies/${req.params.tenant}`).set(
      { onboardingCompletedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("complete-onboarding error:", e);
    res.status(500).json({ error: "internal" });
  }
});

module.exports = router;

