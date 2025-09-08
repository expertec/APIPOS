// server.js
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const path = require("path");
const authRoutes = require("./routes/auth");

const app = express();

// --- CORS ---
const allowedOrigins = [
  "http://localhost:5173", // Vite local
  "http://localhost:3000", // CRA local
  "https://tu-frontend.web.app", // cambia por tu dominio en producción
  "https://tu-dominio.com"
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // para Postman / curl
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin), false);
    },
    credentials: true
  })
);

app.use(express.json());

// --- Firebase Admin ---
// Si estamos en Render, el secret está en /etc/secrets/serviceAccountKey.json
// Si estamos en local, lo puedes tener en ./serviceAccountKey.json
if (!admin.apps.length) {
  try {
    let serviceAccount;
    if (process.env.RENDER) {
      // Render
      serviceAccount = require("/etc/secrets/serviceAccountKey.json");
    } else {
      // Local
      serviceAccount = require(path.join(__dirname, "serviceAccountKey.json"));
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin inicializado");
  } catch (err) {
    console.error("Error inicializando Firebase Admin:", err);
    process.exit(1);
  }
}

// --- Rutas ---
app.get("/api/health", (_, res) => res.json({ ok: true, msg: "API online 🚀" }));
app.use("/api", authRoutes);

// --- Start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API escuchando en http://localhost:${PORT}`));
