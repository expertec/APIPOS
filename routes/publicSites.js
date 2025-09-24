// server/routes/publicSites.js
const express = require("express");
const admin = require("firebase-admin");

const router = express.Router();
const db = () => admin.firestore();

/**
 * GET /api/public/sites/:tenant
 * Devuelve datos públicos del negocio + hasta 6 productos activos.
 * NO expone campos sensibles.
 */
router.get("/sites/:tenant", async (req, res) => {
  try {
    const { tenant } = req.params;

    const companyRef = db().collection("companies").doc(tenant);
    const companySnap = await companyRef.get();
    if (!companySnap.exists) {
      // CORS + 404
      res.set("Access-Control-Allow-Origin", "*");
      return res.status(404).json({ error: "not_found" });
    }

    const company = companySnap.data() || {};

    // Ajusta estos campos a tu estructura real de "companies"
    const payload = {
      seo: {
        title: company?.name || "Negocio",
        description: company?.tagline || company?.description || "",
      },
      brand: {
        name: company?.name || "",
        logoUrl: company?.logoUrl || "",
        primary: company?.brand?.primary || "#1f7a8c",
      },
      contact: {
        whatsapp: company?.contact?.whatsapp || company?.phone || "",
        email: company?.contact?.email || "",
        phone: company?.contact?.phone || "",
      },
      hero: {
        title: company?.hero?.title || company?.name || "Bienvenido",
        subtitle: company?.hero?.subtitle || company?.tagline || "",
      },
      sections: { products: { title: "Productos", items: [] } },
    };

    // Productos públicos (limita y proyecta campos seguros)
    const productsSnap = await companyRef
      .collection("products")
      .where("status", "==", "active")
      .orderBy("name")
      .limit(6)
      .get();

    payload.sections.products.items = productsSnap.docs.map((d) => {
      const p = d.data();

      const priceCents =
        p?.price?.onSale && typeof p?.price?.saleCents === "number"
          ? p.price.saleCents
          : (typeof p?.price?.regularCents === "number" ? p.price.regularCents : null);

      const currency = p?.price?.currency || "MXN";
      const imageUrl =
        (Array.isArray(p.images) && p.images[0]?.url) ||
        p?.media?.coverUrl ||
        "";

      return {
        id: d.id,
        title: p.name,
        text: p.shortDescription || "",
        imageUrl,
        priceFormatted:
          priceCents != null
            ? new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(priceCents / 100)
            : "",
        ctaLink: payload.contact.whatsapp
          ? `https://wa.me/${payload.contact.whatsapp}?text=${encodeURIComponent(`Hola, me interesa: ${p.name}`)}`
          : "",
      };
    });

    // CORS público + caché corto
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "public, max-age=30, s-maxage=60");
    return res.json(payload);
  } catch (e) {
    console.error("public:site", e);
    res.set("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
