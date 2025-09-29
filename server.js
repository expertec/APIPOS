// server.js
require("dotenv").config();

const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const categoriesRouter = require("./routes/categories");

// ---- Firebase Admin init (service account > ENV > applicationDefault) ----
if (!admin.apps.length) {
  try {
    const saPath = path.resolve(__dirname, "serviceAccountKey.json");
    if (fs.existsSync(saPath)) {
      const serviceAccount = require(saPath);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log("[Admin] Inicializado con serviceAccountKey.json");
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
      });
      console.log("[Admin] Inicializado con credenciales por ENV");
    } else {
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
      console.log("[Admin] Inicializado con applicationDefault()");
    }
  } catch (e) {
    console.warn("Firebase Admin no inicializado:", e?.message || e);
  }
}

// ✅ aplica en todos los casos
try {
  const firestore = admin.firestore();
  firestore.settings({ ignoreUndefinedProperties: true });
} catch (e) {
  console.warn("No se pudo aplicar ignoreUndefinedProperties:", e?.message || e);
}

const db = admin.firestore?.();
if (!db) {
  console.error("[FATAL] Firestore Admin no disponible. Revisa credenciales/variables.");
}

// ---- Express app ----
const app = express();

// CORS configuration
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Agregar orígenes por defecto si no hay ninguno configurado
if (ALLOWED_ORIGINS.length === 0) {
  ALLOWED_ORIGINS.push(
    "http://localhost:5173", 
    "http://localhost:5174", 
    "http://localhost:5175",
    "http://localhost:3000",
    "http://127.0.0.1:5500", // Live Server
    "null" // Para archivos locales (file://)
  );
}

// ✅ CORS GLOBAL más permisivo
const corsOptions = {
  origin: function (origin, callback) {
    // Permitir requests sin origin (como apps móviles, Postman, archivos locales)
    if (!origin) return callback(null, true);
    
    // Si el origin está en la lista permitida
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    
    // Si es localhost con cualquier puerto
    if (origin.match(/^https?:\/\/localhost:\d+$/)) {
      return callback(null, true);
    }
    
    // Si es 127.0.0.1 con cualquier puerto
    if (origin.match(/^https?:\/\/127\.0\.0\.1:\d+$/)) {
      return callback(null, true);
    }
    
    console.log(`CORS: Bloqueando origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With',
    'x-tenant', 'X-Tenant' // 👈 añade estos
  ],
  exposedHeaders: ['x-tenant','X-Tenant'], // (opcional)
  preflightContinue: false,
  optionsSuccessStatus: 200
};


// Responder preflight y aplicar CORS general
app.options('*', cors(corsOptions));

app.use(cors(corsOptions));

// ✅ CORS específico para rutas públicas (MÁS PERMISIVO)
app.use("/api/public", cors({
  origin: true, // Permite cualquier origin
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
   'Content-Type','Authorization','Accept','Origin','X-Requested-With',
    'x-tenant','X-Tenant' // 👈 también aquí
  ]

}));

// Middleware para parsear JSON
app.use(express.json());

// ---- Routers (importar DESPUÉS del init de Admin) ----
const plansRouter = require("./routes/plans");
const kpisRouter = require("./routes/kpis");
const adminCompaniesRouter = require("./routes/adminCompanies");     // ✅ crea empresa + publicSite
const invitationsRouter = require("./routes/invitations");
const productsRouter = require("./routes/products");
const publicSitesRouter = require("./routes/publicSites");           // ✅ versión nueva que lee company.publicSite
const adminPublicSitesRouter = require("./routes/adminPublicSites"); // ✅ GET/PUT publicSite (Admin)
// (Opcional) Galería en Admin:
//const adminGalleryRouter = require("./routes/adminGallery");

// Rutas de la API
app.use("/api/admin/companies", adminCompaniesRouter);      // ✅ usa el nuevo router
app.use("/api/admin/invitations", invitationsRouter);
app.use("/api/admin/plans", plansRouter);
app.use("/api/kpis", kpisRouter);
app.use("/api/admin/products", productsRouter);
app.use("/api/admin/categories", categoriesRouter);
app.use("/api/admin/public-sites", adminPublicSitesRouter); // ✅ para el SiteEditor (Admin)

// ✅ Ruta pública con CORS extra permisivo
app.use("/api/public/sites", publicSitesRouter);

// (Opcional)
// app.use("/api/admin/gallery", adminGalleryRouter);

// ---- Opcional: rutas de auth ----
let authRoutes;
try { 
  authRoutes = require("./auth"); 
} catch (_) { 
  try { 
    authRoutes = require("./routes/auth"); 
  } catch { 
    console.warn("Sin rutas /api auth"); 
  } 
}
if (authRoutes) app.use("/api", authRoutes);

// ---- WhatsApp multi-tenant (Baileys) ----
const { createBaileysManager } = require("./wa/manager");
const WA_SESSION_ROOT = process.env.WA_SESSION_ROOT || "/var/data/wa-sessions";
console.log("[WA] WA_SESSION_ROOT =", WA_SESSION_ROOT);
const wa = createBaileysManager({ basePath: WA_SESSION_ROOT });

// WhatsApp endpoints
app.get("/api/wa/:tenant/status", (req, res) => {
  try { 
    return res.json(wa.ensure(req.params.tenant).getStatus()); 
  } catch (e) { 
    console.error("WA status error:", e); 
    return res.status(500).json({ error: "status-failed" }); 
  }
});

app.post("/api/wa/:tenant/start", async (req, res) => {
  try { 
    await wa.ensure(req.params.tenant).start(); 
    return res.json(wa.ensure(req.params.tenant).getStatus()); 
  } catch (e) { 
    console.error("WA start error:", e); 
    return res.status(500).json({ error: "start-failed" }); 
  }
});

app.post("/api/wa/:tenant/logout", async (req, res) => {
  try { 
    await wa.ensure(req.params.tenant).logout(); 
    return res.json({ ok: true }); 
  } catch (e) { 
    console.error("WA logout error:", e); 
    return res.status(500).json({ error: "logout-failed" }); 
  }
});

app.post("/api/wa/:tenant/prepare", (req, res) => {
  try {
    const dir = path.join(WA_SESSION_ROOT, req.params.tenant);
    fs.mkdirSync(dir, { recursive: true });
    return res.json({ ok: true, dir });
  } catch (e) {
    console.error("WA prepare error:", e);
    return res.status(500).json({ error: "prepare-failed" });
  }
});

app.post("/api/wa/:tenant/send-text", async (req, res) => {
  try {
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ error: "missing-to-or-text" });
    const client = wa.ensure(req.params.tenant);
    await client.start();
    const result = await client.sendText(to, text);
    res.json({ ok: true, result });
  } catch (e) {
    console.error("send-text failed", e);
    res.status(500).json({ error: "send-text-failed" });
  }
});

app.get("/api/wa/:tenant/qr", (req, res) => {
  try { 
    return res.json({ qr: wa.ensure(req.params.tenant).getStatus().lastQr || null }); 
  } catch (e) { 
    console.error("WA qr error:", e); 
    return res.status(500).json({ error: "qr-failed" }); 
  }
});

// ---- Health endpoint ----
app.get("/api/health", (_req, res) => {
  res.json({ 
    ok: true, 
    timestamp: new Date().toISOString(),
    cors_origins: ALLOWED_ORIGINS
  });
});

// ---- 404 JSON handler ----
app.use((req, res) => {
  console.log(`404: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: "not_found", path: req.originalUrl });
});

// ---- Error handler JSON ----
app.use((err, req, res, next) => {
  console.error("UNCAUGHT ERROR:", err);
  console.error("Request:", req.method, req.originalUrl);
  const status = err.status || err.code || 500;
  res.status(status).json({ 
    error: err.message || "internal_error",
    path: req.originalUrl 
  });
});

// ---- Listen ----
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 API escuchando en puerto :${PORT}`);
  console.log(`📡 CORS Origins permitidos: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log(`🌍 Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;