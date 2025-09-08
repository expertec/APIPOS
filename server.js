// server.js
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const path = require("path");
const authRoutes = require("./routes/auth");

const app = express();

// --- CORS ---
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://tu-frontend.web.app", // <-- cambia a tu dominio real
  "https://tu-dominio.com"
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // Postman/curl
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin), false);
    },
    credentials: true
  })
);

app.use(express.json());

// --- Firebase Admin ---
// En Render, guarda tu JSON como secret file en /etc/secrets/serviceAccountKey.json
if (!admin.apps.length) {
  try {
    let serviceAccount;
    if (process.env.RENDER) {
      serviceAccount = require("/etc/secrets/serviceAccountKey.json");
    } else {
      serviceAccount = require(path.join(__dirname, "serviceAccountKey.json"));
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("Firebase Admin inicializado");
  } catch (err) {
    console.error("Error inicializando Firebase Admin:", err);
    process.exit(1);
  }
}

// ⚠️ IMPORTANTE: requiere waMulti DESPUÉS de inicializar Admin
const { startWhatsApp, getStatus, sendText, logout } = require("./waMulti");

// --- Rutas básicas ---
app.get("/api/health", (_, res) => res.json({ ok: true, msg: "API online 🚀" }));
app.use("/api", authRoutes);

// --- Endpoints WhatsApp multi-negocio ---
app.post("/api/wa/:orgId/:businessId/start", async (req, res) => {
  try {
    const { orgId, businessId } = req.params;
    await startWhatsApp(orgId, businessId);
    res.json({ ok: true });
  } catch (e) {
    console.error("wa start error", e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/wa/:orgId/:businessId/status", (req, res) => {
  const { orgId, businessId } = req.params;
  res.json(getStatus(orgId, businessId));
});

app.post("/api/wa/:orgId/:businessId/send", async (req, res) => {
  try {
    const { orgId, businessId } = req.params;
    const { to, text } = req.body;
    if (!to || !text) return res.status(400).json({ error: "to y text son requeridos" });
    const r = await sendText(orgId, businessId, to, text);
    res.json(r);
  } catch (e) {
    console.error("wa send error", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/wa/:orgId/:businessId/logout", async (req, res) => {
  try {
    const { orgId, businessId } = req.params;
    const r = await logout(orgId, businessId);
    res.json(r);
  } catch (e) {
    console.error("wa logout error", e);
    res.status(500).json({ error: e.message });
  }
});

// --- Start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API escuchando en http://localhost:${PORT}`));
