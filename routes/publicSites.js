// routes/publicSites.js
const express = require("express");
const admin = require("firebase-admin");

const router = express.Router();
const db = () => admin.firestore();

/** Utilidad para formatear dinero */
function moneyFromCents(cents, currency = "MXN", locale = "es-MX") {
  if (typeof cents !== "number") return null;
  try { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100); }
  catch { return `$${(cents / 100).toFixed(2)} ${currency}`; }
}

/** “mejor esfuerzo” para portada */
function pickCoverUrl(p = {}) {
  if (p?.media?.coverUrl) return p.media.coverUrl;
  if (p?.cover?.url) return p.cover.url;
  if (typeof p?.cover === "string") return p.cover;
  if (Array.isArray(p?.images) && p.images[0]?.url) return p.images[0].url;
  if (Array.isArray(p?.gallery) && p.gallery[0]?.url) return p.gallery[0].url;
  if (p?.image) return p.image;
  if (p?.photo) return p.photo;
  return null;
}

/**
 * GET /api/public/sites/:tenant
 * Opcional: ?limit=12&type=physical|digital|service&onSale=true
 */
router.get("/:tenant", async (req, res) => {
  const { tenant } = req.params;
  const { limit = 12, type, onSale } = req.query;

  try {
    const companyRef = db().collection("companies").doc(tenant);
    const companySnap = await companyRef.get();
    if (!companySnap.exists) {
      return res.status(404).json({ error: "not_found", message: "Company/tenant not found" });
    }
    const company = companySnap.data() || {};

    // Leer algunos metadatos “opcionales”
    const brand = {
      name: company?.name || tenant,
      logoUrl: company?.brand?.logoUrl || company?.logoUrl || "",
      primaryColor: company?.theme?.primary || "#1f7a8c",
      secondaryColor: company?.theme?.secondary || "#14535f",
    };

    const hero = {
      title: company?.site?.hero?.title || company?.headline || company?.name || "Bienvenido",
      subtitle: company?.site?.hero?.subtitle || company?.tagline || "",
      bgUrl: company?.site?.hero?.bgUrl || "",
    };

    // Query productos con filtros “blandos” y sin reventar índices
    let ref = companyRef.collection("products");
    if (type) ref = ref.where("type", "==", String(type));
    if (onSale === "true") ref = ref.where("price.onSale", "==", true);
    // Para evitar índices compuestos, ordenaremos por name si no hay filtros de búsqueda
    ref = ref.orderBy("name").limit(Number(limit) || 12);

    let products = [];
    try {
      const snap = await ref.get();
      products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      // Si falla por índice, devolvemos lista vacía sin romper
      console.warn("[publicSites] products query failed (likely index):", e?.message);
      products = [];
    }

    const items = products.map((p) => {
      const img = pickCoverUrl(p);
      const price = p?.price || {};
      return {
        id: p.id,
        title: p?.name || "Producto",
        text: p?.shortDescription || "",
        imageUrl: img || "",
        priceFormatted:
          price?.onSale && typeof price?.saleCents === "number"
            ? moneyFromCents(price.saleCents, price?.currency)
            : moneyFromCents(price?.regularCents, price?.currency),
        ctaLink: company?.contact?.whatsApp
          ? `https://wa.me/${company.contact.whatsApp}?text=${encodeURIComponent(
              `Hola, me interesa ${p?.name || "un producto"}.`
            )}`
          : null,
      };
    });

    const payload = {
      tenant,
      brand,
      hero,
      sections: {
        products: {
          title: "Productos",
          items,
        },
      },
      generatedAt: new Date().toISOString(),
    };

    return res.json(payload);
  } catch (e) {
    console.error("publicSites:get", e);
    return res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
