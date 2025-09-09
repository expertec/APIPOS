// server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const authRoutes = require("./auth");           // tus rutas /api/register, /api/create-admin
const wa = require("./waMulti");                // <-- IMPORTA las funciones de WhatsApp

// ========= Firebase Admin =========
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
  console.log("Firebase Admin inicializado");
}

// ========= App =========
const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());

// ========= Rutas de Auth / Admin =========
app.use("/api", authRoutes);

// ========= WhatsApp (multi-negocio) =========
//
// IMPORTANTE: en Render usa una carpeta persistente. /data es persistente.
// Puedes cambiar WA_BASE_DIR en variables de entorno si quieres otra ruta.
const WA_BASE_DIR = process.env.WA_BASE_DIR || "/data/wa-sessions";

// Inicializa el manejador WA
wa.init({
  baseDir: WA_BASE_DIR,
  // puedes añadir más flags si los expusiste en waMulti.js
});

// Status de la sesión
app.get("/api/wa/:orgId/:businessId/status", async (req, res) => {
  try {
    const { orgId, businessId } = req.params;
    const data = await wa.status(orgId, businessId);
    return res.json(data);
  } catch (err) {
    console.error("WA status error:", err);
    return res.status(500).json({ error: "WA status error" });
  }
});

// Iniciar / reiniciar (genera QR si no hay sesión)
app.post("/api/wa/:orgId/:businessId/start", async (req, res) => {
  try {
    const { orgId, businessId } = req.params;
    const data = await wa.start(orgId, businessId);
    return res.json(data);
  } catch (err) {
    console.error("WA start error:", err);
    return res.status(500).json({ error: "WA start error" });
  }
});

// Logout (cierra sesión y borra carpeta de esa sesión)
app.post("/api/wa/:orgId/:businessId/logout", async (req, res) => {
  try {
    const { orgId, businessId } = req.params;
    const data = await wa.logout(orgId, businessId);
    return res.json(data);
  } catch (err) {
    console.error("WA logout error:", err);
    return res.status(500).json({ error: "WA logout error" });
  }
});

// Enviar mensaje de prueba
app.post("/api/wa/:orgId/:businessId/send-test", async (req, res) => {
  try {
    const { orgId, businessId } = req.params;
    const { to, message } = req.body || {};
    if (!to || !message) {
      return res.status(400).json({ error: "to y message son requeridos" });
    }
    const data = await wa.sendTest(orgId, businessId, to, message);
    return res.json(data);
  } catch (err) {
    console.error("WA send-test error:", err);
    return res.status(500).json({ error: "WA send-test error" });
  }
});

// ========= Health =========
app.get("/", (_req, res) => {
  res.send("OK");
});

// ========= Start =========
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`API escuchando en http://localhost:${PORT}`);
});
