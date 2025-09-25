// routes/publicSites.js
const express = require("express");
const admin = require("firebase-admin");

const router = express.Router();
const db = () => admin.firestore();

/** Helpers */
const fmtMXN = (n) => {
  if (typeof n !== "number") return null;
  try { return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n); }
  catch { return `$${n.toFixed(2)} MXN`; }
};

function pickCoverUrl(p = {}) {
  if (p?.media?.coverUrl) return p.media.coverUrl;
  if (p?.cover?.url) return p.cover.url;
  if (typeof p?.cover === "string") return p.cover;
  if (Array.isArray(p?.images) && p.images[0]?.url) return p.images[0].url;
  if (Array.isArray(p?.gallery) && p.gallery[0]?.url) return p.gallery[0].url;
  if (p?.imageUrl) return p.imageUrl;
  if (p?.image) return p.image;
  if (p?.photo) return p.photo;
  return null;
}

const cleanWa = (s) => (s || "").replace(/[^+\d]/g, "").replace("+", "");
const waLink = (num, text) => (num ? `https://wa.me/${cleanWa(num)}?text=${encodeURIComponent(text || "Hola")}` : "");

/** Carga items desde /products o /items con flags web */
async function loadItems({ tenant, collection, cfg, whatsapp }) {
  if (!cfg || cfg.enabled === false) return null;

  let ref = db().collection(`companies/${tenant}/${collection}`)
    .where("visibilityWeb", "==", true);

  // status=active si existe ese campo
  try { ref = ref.where("status", "==", "active"); } catch {}

  if (cfg.categoryId) ref = ref.where("categoryId", "==", cfg.categoryId);

  // orden principal por webSort asc (asegúrate del índice)
  ref = ref.orderBy("webSort", "asc");

  const limit = Number(cfg.limit || 12);
  let snap;
  try {
    snap = await ref.limit(limit).get();
  } catch (e) {
    console.warn("[publicSites] query items fallback:", e?.message);
    // Fallback suave: sin filtros adicionales
    snap = await db()
      .collection(`companies/${tenant}/${collection}`)
      .orderBy("webSort", "asc")
      .limit(limit)
      .get();
  }

  const items = snap.docs.map((d) => {
    const x = d.data() || {};
    // soporta priceCents o price (number)
    const price = typeof x.price === "number"
      ? x.price
      : (typeof x.priceCents === "number" ? x.priceCents / 100 : undefined);

    return {
      id: d.id,
      title: x.name || x.title || "Item",
      text: x.shortDescription || x.description || x.text || "",
      imageUrl: pickCoverUrl(x) || "",
      price,
      priceFormatted: typeof price === "number" ? fmtMXN(price) : (x.priceFormatted || null),
      ctaLink: whatsapp ? waLink(whatsapp, `Hola, me interesa ${x.name || x.title || "un artículo"}`) : null,
    };
  });

  return { title: cfg.title || undefined, items };
}

/** Carga galería desde subcolección /gallery */
async function loadGallery(tenant, limit) {
  try {
    const qs = await db()
      .collection(`companies/${tenant}/gallery`)
      .orderBy("sort", "asc")
      .limit(Math.max(1, limit || 12))
      .get();
    return qs.docs.map((d) => {
      const x = d.data() || {};
      return { src: x.url, alt: x.alt || "" };
    });
  } catch (e) {
    console.warn("[publicSites] gallery failed:", e?.message);
    return [];
  }
}

/**
 * GET /api/public/sites/:tenant
 * (CSR templates friendly)
 */
router.get("/:tenant", async (req, res) => {
  const { tenant } = req.params;

  try {
    const companyRef = db().collection("companies").doc(tenant);
    const companySnap = await companyRef.get();
    if (!companySnap.exists) {
      return res.status(404).json({ error: "not_found", message: "Company/tenant not found" });
    }
    const company = companySnap.data() || {};
    const site = company.publicSite || {}; // ← NUEVO: config desde publicSite

    // Contacto / WhatsApp (comercio primero, nav como fallback)
    const whatsappRaw = site?.commerce?.whatsappNumber || site?.nav?.whatsapp || company?.contact?.whatsApp || "";
    const whatsapp = cleanWa(whatsappRaw);

    // BRAND
    const brand = {
      name: site?.brand?.name || company?.name || tenant,
      logoUrl: site?.brand?.logoUrl || company?.brand?.logoUrl || company?.logoUrl || "",
      primaryColor: site?.brand?.primaryColor || company?.theme?.primary || "#1f7a8c",
      secondaryColor: site?.brand?.secondaryColor || company?.theme?.secondary || "#14535f",
    };

    // HERO
    const hero = {
      title: site?.hero?.title || company?.site?.hero?.title || company?.headline || company?.name || "Bienvenido",
      subtitle: site?.hero?.subtitle || company?.site?.hero?.subtitle || company?.tagline || "",
      bgUrl: site?.hero?.bgUrl || company?.site?.hero?.bgUrl || "",
    };

    // CONTACT (nuevo bloque)
    const contact = {
      phone: site?.nav?.phone || company?.contact?.phone || "",
      whatsapp: whatsapp,
      email: site?.nav?.email || company?.contact?.email || "",
      address: site?.nav?.address || company?.contact?.address || "",
      instagram: site?.nav?.instagram || company?.contact?.instagram || "",
      facebook: site?.nav?.facebook || company?.contact?.facebook || "",
      tiktok: site?.nav?.tiktok || company?.contact?.tiktok || "",
      mapsLink: site?.nav?.mapsLink || company?.contact?.mapsLink || "",
    };

    // SECCIONES (products/services/menu/rooms + gallery)
    const sectionsCfg = site?.sections || {};
    const sections = {};

    // PRODUCTS (tienda)
    if (sectionsCfg?.products?.enabled !== false) {
      const products = await loadItems({ tenant, collection: "products", cfg: sectionsCfg.products, whatsapp });
      if (products && products.items.length) sections.products = products;
    }

    // SERVICES (servicios)
    if (sectionsCfg?.services?.enabled) {
      // por convención: services desde /items
      const services = await loadItems({ tenant, collection: "items", cfg: sectionsCfg.services, whatsapp });
      if (services && services.items.length) sections.services = services;
    }

    // MENU (restaurantes)
    if (sectionsCfg?.menu?.enabled) {
      // menú también suele vivir en /items
      const menu = await loadItems({ tenant, collection: "items", cfg: sectionsCfg.menu, whatsapp });
      if (menu && menu.items.length) sections.menu = menu;
    }

    // ROOMS (hotel) — normalmente en /products
    if (sectionsCfg?.rooms?.enabled) {
      const rooms = await loadItems({ tenant, collection: "products", cfg: sectionsCfg.rooms, whatsapp });
      if (rooms && rooms.items.length) sections.rooms = rooms;
    }

    // GALLERY (para todos, si enabled)
    if (sectionsCfg?.gallery?.enabled) {
      sections.gallery = {
        title: sectionsCfg.gallery.title || "Galería",
        images: await loadGallery(tenant, sectionsCfg.gallery.limit),
      };
    }

    // SEO / COMMERCE / STATUS
    const commerce = site?.commerce || { checkoutMode: "whatsapp", whatsappNumber: whatsapp };
    const seo = site?.seo || {};
    const status = site?.status || "draft";

    const payload = {
      tenant,
      template: site?.template || "shop",
      brand,
      hero,
      contact,
      commerce,
      seo,
      sections,
      status,
      generatedAt: new Date().toISOString(),
    };

    res.set("Cache-Control", "public, max-age=60, s-maxage=300");
    return res.json(payload);
  } catch (e) {
    console.error("publicSites:get", e);
    return res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
