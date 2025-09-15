require("dotenv").config();

const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");



// ===== Firebase Admin =====
if (!admin.apps.length) {
  // Usa credenciales de entorno (Render) o applicationDefault()
  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  } catch (e) {
    console.warn("Firebase Admin no inicializado:", e?.message || e);
  }
}
const db = admin.firestore?.();

// ===== App =====
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ===== Auth routes (solo si existen) =====
let authRoutes;
try {
  authRoutes = require("./auth");
} catch (_) {
  try { authRoutes = require("./routes/auth"); } catch (e) {
    console.warn("No se encontró auth.js ni routes/auth.js; /api auth no se montará.");
  }
}
if (authRoutes) app.use("/api", authRoutes);

// ===== WhatsApp multi-tenant =====
const { createBaileysManager } = require("./wa/manager"); // si usas wa/manager.js
// Si sigues usando waMulti.js tal como lo tenías, cambia la línea anterior por:
// const { startWhatsApp, getStatus, sendText, logout } = require("./waMulti");

// server.js
const WA_SESSION_ROOT =
  process.env.WA_SESSION_ROOT || "/var/data/wa-sessions";

console.log("[WA] WA_SESSION_ROOT =", WA_SESSION_ROOT);


const wa = createBaileysManager({ basePath: WA_SESSION_ROOT });

// Status
app.get("/api/wa/:tenant/status", async (req, res) => {
  try {
    const { tenant } = req.params;
    return res.json(wa.ensure(tenant).getStatus());
  } catch (e) {
    return res.status(500).json({ error: "status-failed" });
  }
});

// Start (crea carpeta si no existe y emite QR si no hay sesión)
app.post("/api/wa/:tenant/start", async (req, res) => {
  try {
    const { tenant } = req.params;
    await wa.ensure(tenant).start();
    return res.json(wa.ensure(tenant).getStatus());
  } catch (e) {
    return res.status(500).json({ error: "start-failed" });
  }
});

// Logout
app.post("/api/wa/:tenant/logout", async (req, res) => {
  try {
    const { tenant } = req.params;
    await wa.ensure(tenant).logout();
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "logout-failed" });
  }
});

// Opcional: preparar carpeta
app.post("/api/wa/:tenant/prepare", (req, res) => {
  try {
    const { tenant } = req.params;
    const dir = path.join(WA_SESSION_ROOT, tenant);
    fs.mkdirSync(dir, { recursive: true });
    return res.json({ ok: true, dir });
  } catch (e) {
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

// QR actual (si existe)
app.get("/api/wa/:tenant/qr", async (req, res) => {
  try {
    const { tenant } = req.params;
    const s = wa.ensure(tenant).getStatus();
    return res.json({ qr: s.lastQr || null });
  } catch (e) {
    return res.status(500).json({ error: "qr-failed" });
  }
});

// Health
app.get("/", (_req, res) => res.send("OK"));

// Listen
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`API escuchando en :${PORT}`));
