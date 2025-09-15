// server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// Rutas de auth (tu archivo actual)
// const authRoutes = require("./auth");

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
    origin: true, // en prod pon tu(s) dominio(s) aquí
    credentials: true,
  })
);
app.use(express.json());

// ========= Rutas de Auth / Admin =========
app.use("/api", authRoutes);

// ========= WhatsApp (multi-negocio) =========
// Importa las funciones REALES de waMulti
const { startWhatsApp, getStatus, sendText, logout } = require("./waMulti");

// Unifica la variable de entorno con la que usa waMulti.js
// (waMulti lee WA_SESSION_ROOT internamente; aquí es opcional leerla, pero la dejamos por consistencia)
process.env.WA_SESSION_ROOT = process.env.WA_SESSION_ROOT || "/var/data/wa-sessions";

// Status de la sesión
app.get("/api/wa/:orgId/:businessId/status", async (req, res) => {
  try {
    const { orgId, businessId } = req.params;
    const data = await getStatus(orgId, businessId);
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
    const runtime = await startWhatsApp(orgId, businessId);
    // Devolvemos el estado actual (puede venir 'qr', 'connecting' o 'connected')
    const data = await getStatus(orgId, businessId);
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
    const data = await logout(orgId, businessId);
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
    const data = await sendText(orgId, businessId, to, message);
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
