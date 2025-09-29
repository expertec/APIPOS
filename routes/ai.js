// routes/ai.js
const express = require("express");
const router = express.Router();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o-mini"; // pon tu modelo

if (!OPENAI_API_KEY) {
  console.warn("[AI] Falta OPENAI_API_KEY en variables de entorno");
}

/**
 * POST /api/admin/ai/brief
 * body: { brief: string, mode?: "products"|"services", industry?: string }
 * devuelve: { name, slugSuggestion, mode, industry, publicSitePatch }
 */
router.post("/brief", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "ai_disabled" });

    const { brief = "", mode, industry } = req.body || {};
    const sys = `
Eres un asistente que devuelve JSON estricto para configurar el sitio público de un negocio.
Estructura que debes devolver:

{
  "name": "Nombre de marca si lo deduces",
  "slugSuggestion": "slug-url-amigable",
  "mode": "products" | "services",
  "industry": "retail|restaurant|hotel|salud|belleza|educacion|servicios|otra",
  "publicSitePatch": {
    "brand": { "name": "...", "logoUrl": "", "primaryColor": "#1f7a8c", "secondaryColor": "#14535f" },
    "hero": { "title": "...", "subtitle": "...", "bgUrl": "" },
    "nav": { "phone": "", "whatsapp": "", "email": "", "address": "", "instagram": "", "facebook": "", "tiktok": "", "mapsLink": "" },
    "sections": {
      "products": { "title": "Productos", "enabled": true,  "limit": 12, "layout": "grid" },
      "services": { "title": "Servicios", "enabled": false, "limit": 12, "layout": "grid" },
      "menu":     { "title": "Menú",     "enabled": false, "limit": 24, "layout": "list" },
      "rooms":    { "title": "Habitaciones","enabled": false, "limit": 12, "layout": "grid" },
      "gallery":  { "title": "Galería",  "enabled": true, "images": [] },
      "testimonials": { "title": "Testimonios", "enabled": false, "limit": 6 },
      "about": { "title": "Sobre nosotros", "enabled": false, "text": "" },
      "ctaBar": { "enabled": false, "text": "", "buttonText": "", "buttonLink": "" }
    },
    "commerce": { "checkoutMode": "whatsapp", "whatsappNumber": "" },
    "seo": { "title": "", "description": "", "ogImageUrl": "" }
  }
}

Reglas:
- Si el usuario vende comida -> industry="restaurant" y activa "menu".
- Si es hotel/spa con reservaciones -> industry="hotel" o "salud/belleza" y habilita "services" y/o "reservations".
- Si menciona productos/tienda -> mode="products" y habilita "products".
- Usa colores sugeridos por la descripción si aparecen (p.ej. “colores cálidos y modernos” -> primario cálido, secundario neutro).
- Devuelve JSON válido. No agregues texto fuera del JSON.
    `;

    const user = `
Descripción del negocio:
"""
${brief}
"""
Preferencias del usuario (opcionales):
- Modo sugerido: ${mode || "no especificado"}
- Industria sugerida: ${industry || "no especificada"}

Devuelve solo el JSON con las claves exactas indicadas.
`;

    // Llamada OpenAI REST minimalista
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });

    if (!r.ok) {
      const msg = await r.text().catch(()=> "");
      console.error("[AI] error", r.status, msg);
      return res.status(500).json({ error: "ai_failed", detail: msg });
    }
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(content); }
    catch { return res.status(500).json({ error: "bad_ai_json" }); }

    return res.json({ ok: true, ...parsed });
  } catch (e) {
    console.error("AI /brief error", e);
    return res.status(500).json({ error: "internal" });
  }
});

module.exports = router;
