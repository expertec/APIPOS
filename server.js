require("dotenv").config();

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// ===== Firebase Admin =====
if (!admin.apps.length) {
  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  } catch (e) {
    console.warn("Firebase Admin no inicializado:", e?.message || e);
  }
}

const db = admin.firestore?.();
if (!db) {
  console.error("[FATAL] Firestore Admin no disponible. Revisa credenciales/variables.");
  // no salimos del proceso, pero cualquier ruta que toque `db` fallará.
}

// ===== App =====
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ===== Middleware: verifica ID Token de Firebase =====
async function verifyFirebaseIdToken(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded; // { uid, email, ... }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ===== Helpers =====
async function assertOwner(tenantId, uid) {
  if (!db) throw Object.assign(new Error("DB not initialized"), { code: 500 });
  const ref = db.collection("companies").doc(tenantId);
  const snap = await ref.get();
  if (!snap.exists) {
    const err = new Error("Company not found");
    err.code = 404;
    throw err;
  }
  const ownerUid = snap.get("ownerUid");
  if (ownerUid !== uid) {
    const err = new Error("Forbidden");
    err.code = 403;
    throw err;
  }
}

// ===== Auth routes (opcionales si existen) =====
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
const { createBaileysManager } = require("./wa/manager");
const WA_SESSION_ROOT = process.env.WA_SESSION_ROOT || "/var/data/wa-sessions";
console.log("[WA] WA_SESSION_ROOT =", WA_SESSION_ROOT);
const wa = createBaileysManager({ basePath: WA_SESSION_ROOT });

// Status
app.get("/api/wa/:tenant/status", async (req, res) => {
  try {
    const { tenant } = req.params;
    return res.json(wa.ensure(tenant).getStatus());
  } catch (e) {
    console.error("WA status error:", e);
    return res.status(500).json({ error: "status-failed" });
  }
});

// Start
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

// Logout
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

// Prepare
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

// Send text
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

// QR
app.get("/api/wa/:tenant/qr", async (req, res) => {
  try {
    const { tenant } = req.params;
    const s = wa.ensure(tenant).getStatus();
    return res.json({ qr: s.lastQr || null });
  } catch (e) {
    console.error("WA qr error:", e);
    return res.status(500).json({ error: "qr-failed" });
  }
});

// ===== Invitaciones de agentes (owner-required) =====
const APP_BASE_URL = process.env.APP_BASE_URL || "https://negociosweb.mx";

/**
 * Crea una invitación de agente
 * POST /api/admin/invitations
 * body: { tenantId, email, role? = "agent" }
 * header: Authorization: Bearer <idToken>
 */
app.post("/api/admin/invitations", verifyFirebaseIdToken, async (req, res) => {
  try {
    const { tenantId, email, role = "agent" } = req.body || {};
    if (!tenantId || !email) {
      return res.status(400).json({ error: "tenantId & email required" });
    }

    await assertOwner(tenantId, req.user.uid);

    const inviteId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    );

    await db.collection("companies").doc(tenantId)
      .collection("invitations").doc(inviteId)
      .set({
        email: String(email).toLowerCase(),
        role,
        token,
        status: "pending",
        createdAt: now,
        expiresAt,
        inviterUid: req.user.uid,
      });

    const link = `${APP_BASE_URL}/accept-invite?tenant=${encodeURIComponent(tenantId)}&inviteId=${inviteId}&token=${token}`;
    return res.status(201).json({ ok: true, inviteId, link, role });
  } catch (e) {
    console.error("create invitation failed:", e);
    const code = e.code || 500;
    return res.status(code).json({ error: e.message || "error" });
  }
});

/**
 * (Opcional) Lista invitaciones de un tenant (owner)
 * GET /api/admin/invitations?tenantId=foo
 */
app.get("/api/admin/invitations", verifyFirebaseIdToken, async (req, res) => {
  try {
    const tenantId = req.query.tenantId;
    if (!tenantId) return res.status(400).json({ error: "tenantId required" });

    await assertOwner(tenantId, req.user.uid);

    const qs = await db.collection("companies").doc(tenantId)
      .collection("invitations")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const items = qs.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json({ ok: true, items });
  } catch (e) {
    console.error("list invitations failed:", e);
    const code = e.code || 500;
    return res.status(code).json({ error: e.message || "error" });
  }
});

/**
 * Acepta una invitación
 * POST /api/admin/invitations/accept
 * body: { tenantId, inviteId, token }
 * header: Authorization: Bearer <idToken>
 */
app.post("/api/admin/invitations/accept", verifyFirebaseIdToken, async (req, res) => {
  try {
    const { tenantId, inviteId, token } = req.body || {};
    if (!tenantId || !inviteId || !token) {
      return res.status(400).json({ error: "tenantId, inviteId, token required" });
    }

    const invRef = db.collection("companies").doc(tenantId)
      .collection("invitations").doc(inviteId);
    const invSnap = await invRef.get();
    if (!invSnap.exists) return res.status(404).json({ error: "Invitation not found" });

    const inv = invSnap.data();
    if (inv.status !== "pending" || inv.token !== token) {
      return res.status(403).json({ error: "Invalid invitation" });
    }
    if (inv.expiresAt.toMillis() < Date.now()) {
      return res.status(410).json({ error: "Invitation expired" });
    }

    const userEmail = (req.user.email || "").toLowerCase();
    if (!userEmail || userEmail !== String(inv.email).toLowerCase()) {
      return res.status(403).json({ error: "Email mismatch" });
    }

    await db.collection("companies").doc(tenantId)
      .collection("members").doc(req.user.uid)
      .set({
        uid: req.user.uid,
        email: userEmail,
        role: inv.role || "agent",
        status: "active",
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

    await invRef.update({
      status: "accepted",
      acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("accept invitation failed:", e);
    const code = e.code || 500;
    return res.status(code).json({ error: e.message || "error" });
  }
});

// ===== Health =====
app.get("/", (_req, res) => res.json({ ok: true }));

// ===== 404 JSON siempre =====
app.use((req, res) => {
  res.status(404).json({ error: "not_found", path: req.originalUrl });
});

// ===== Error handler JSON siempre =====
app.use((err, req, res, _next) => {
  console.error("UNCAUGHT ERROR:", err);
  const status = err.status || err.code || 500;
  res.status(status).json({ error: err.message || "internal_error" });
});

// ===== Listen =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`API escuchando en :${PORT}`));
