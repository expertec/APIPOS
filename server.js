// server.js
require("dotenv").config();

const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// ---- Firebase Admin init (service account > applicationDefault > ENV) ----
if (!admin.apps.length) {
  try {
    const saPath = path.resolve(__dirname, "serviceAccountKey.json");
    if (fs.existsSync(saPath)) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
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

const db = admin.firestore?.();
if (!db) {
  console.error("[FATAL] Firestore Admin no disponible. Revisa credenciales/variables.");
}

// ---- Express app ----
const app = express();

// CORS: ajusta tus orígenes
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
if (ALLOWED_ORIGINS.length === 0) {
  ALLOWED_ORIGINS.push("http://localhost:5173", "http://localhost:5174", "http://localhost:5175");
}
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: false }));
app.use(express.json());

// ---- Routers (importar DESPUÉS del init de Admin) ----
const plansRouter = require("./routes/plans");
const kpisRouter = require("./routes/kpis");
const companiesRouter = require("./routes/companies");
const invitationsRouter = require("./routes/invitations");

// (Opcional) proteger con tu middleware de auth si aplica:
// const { verifyFirebaseIdToken } = require("./middleware/auth");
// app.use("/api/kpis", verifyFirebaseIdToken);

app.use("/api/admin/companies", companiesRouter);
app.use("/api/admin/invitations", invitationsRouter);
app.use("/api/admin/plans", plansRouter);
app.use("/api/kpis", kpisRouter);

// ---- Opcional: rutas de auth si las tienes ----
let authRoutes;
try {
  authRoutes = require("./auth");
} catch (_) {
  try {
    authRoutes = require("./routes/auth");
  } catch (e) {
    console.warn("No se encontró auth.js ni routes/auth.js; /api auth no se montará.");
  }
}
if (authRoutes) app.use("/api", authRoutes);

// ---- WhatsApp multi-tenant (Baileys) ----
const { createBaileysManager } = require("./wa/manager");
const WA_SESSION_ROOT = process.env.WA_SESSION_ROOT || "/var/data/wa-sessions";
console.log("[WA] WA_SESSION_ROOT =", WA_SESSION_ROOT);
const wa = createBaileysManager({ basePath: WA_SESSION_ROOT });

app.get("/api/wa/:tenant/status", (req, res) => {
  try {
    const { tenant } = req.params;
    return res.json(wa.ensure(tenant).getStatus());
  } catch (e) {
    console.error("WA status error:", e);
    return res.status(500).json({ error: "status-failed" });
  }
});

app.post("/api/wa/:tenant/start", async (req, res) => {
  try {
    const { tenant } = req.params;
    await wa.ensure(tenant).start();
    return res.json(wa.ensure(tenant).getStatus());
  } catch (e) {
    console.error("WA start error:", e);
    return res.status(500).json({ error: "start-failed" });
  }
});

app.post("/api/wa/:tenant/logout", async (req, res) => {
  try {
    const { tenant } = req.params;
    await wa.ensure(tenant).logout();
    return res.json({ ok: true });
  } catch (e) {
    console.error("WA logout error:", e);
    return res.status(500).json({ error: "logout-failed" });
  }
});

app.post("/api/wa/:tenant/prepare", (req, res) => {
  try {
    const { tenant } = req.params;
    const dir = path.join(WA_SESSION_ROOT, tenant);
    fs.mkdirSync(dir, { recursive: true });
    return res.json({ ok: true, dir });
  } catch (e) {
    console.error("WA prepare error:", e);
    return res.status(500).json({ error: "prepare-failed" });
  }
});

app.post("/api/wa/:tenant/send-text", async (req, res) => {
  try {
    const { tenant } = req.params;
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ error: "missing-to-or-text" });
    const client = wa.ensure(tenant);
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
    const { tenant } = req.params;
    const s = wa.ensure(tenant).getStatus();
    return res.json({ qr: s.lastQr || null });
  } catch (e) {
    console.error("WA qr error:", e);
    return res.status(500).json({ error: "qr-failed" });
  }
});

// ---- Health ----
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---- 404 JSON ----
app.use((req, res) => {
  res.status(404).json({ error: "not_found", path: req.originalUrl });
});

// ---- Error handler JSON ----
app.use((err, _req, res, _next) => {
  console.error("UNCAUGHT ERROR:", err);
  const status = err.status || err.code || 500;
  res.status(status).json({ error: err.message || "internal_error" });
});

// ---- Listen ----
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`API escuchando en :${PORT} - ORIGINS: ${ALLOWED_ORIGINS.join(", ")}`)
);
