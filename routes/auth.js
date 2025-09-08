// routes/auth.js
const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");

/**
 * Middleware de autorización:
 * - Acepta X-ADMIN-KEY (server-to-server) o
 * - Bearer <idToken> y verifica que el usuario sea superadmin
 *   (por custom claim o por el documento /users/{uid}).
 */
async function requireSuperadminOrKey(req, res, next) {
  try {
    // 1) API Key
    const key = req.headers["x-admin-key"];
    if (key && key === process.env.ADMIN_API_KEY) return next();

    // 2) Bearer <idToken>
    const authH = req.headers.authorization || "";
    const m = authH.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: "Unauthorized" });

    const idToken = m[1];
    const decoded = await admin.auth().verifyIdToken(idToken);

    // a) Claim directo
    if (decoded.role === "superadmin") return next();

    // b) Verificación por Firestore
    const snap = await admin.firestore().collection("users").doc(decoded.uid).get();
    const role = snap.exists ? snap.data().role : null;
    if (role === "superadmin") return next();

    return res.status(403).json({ error: "Forbidden" });
  } catch (e) {
    console.error("authz error:", e);
    return res.status(401).json({ error: "Unauthorized" });
  }
}

// Ver proyecto (protegido por API KEY)
router.get("/health-admin", async (req, res) => {
  const key = req.headers["x-admin-key"];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const appOpts = admin.app().options || {};
  res.json({
    ok: true,
    projectId: appOpts.projectId || null,
    databaseURL: appOpts.databaseURL || null,
  });
});

// Ver si un email existe en Auth y/o Firestore (protegido por API KEY)
router.get("/debug-user", async (req, res) => {
  const key = req.headers["x-admin-key"];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const email = String(req.query.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "email requerido" });

  try {
    const user = await admin.auth().getUserByEmail(email);
    const doc = await admin.firestore().collection("users").doc(user.uid).get();
    return res.json({
      ok: true,
      authUser: { uid: user.uid, email: user.email, disabled: user.disabled, displayName: user.displayName },
      userDoc: doc.exists ? { id: doc.id, ...doc.data() } : null,
    });
  } catch {
    return res.json({ ok: true, authUser: null, userDoc: null, note: "No existe en Auth o Firestore" });
  }
});


/**
 * Registro público (opcional):
 * - Crea usuario con rol "agent" por defecto.
 * - Asigna una org/negocio por defecto (ajusta a tu flujo real).
 * - Devuelve custom token para signInWithCustomToken en el cliente.
 */
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Faltan campos" });
    }

    // 1) Crear usuario en Firebase Auth
    const userRecord = await admin.auth().createUser({
      displayName: name,
      email,
      password,
    });
    const uid = userRecord.uid;

    // 2) Claims por defecto (ajusta estos valores a tu onboarding real)
    const claims = {
      role: "agent",
      orgId: "ORG_ABC",
      businessIds: ["BIZ_01"],
      defaultBusinessId: "BIZ_01",
    };
    await admin.auth().setCustomUserClaims(uid, claims);

    // 3) Perfil en Firestore (fuente de verdad para la UI y reglas basadas en /users/{uid})
    await admin.firestore().collection("users").doc(uid).set({
      name,
      email,
      role: claims.role,
      orgId: claims.orgId,
      businessIds: claims.businessIds,
      defaultBusinessId: claims.defaultBusinessId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 4) Custom token para que el cliente haga signInWithCustomToken
    const token = await admin.auth().createCustomToken(uid, claims);
    res.json({ token });
  } catch (err) {
    console.error("Register error:", err);
    if (err.code === "auth/email-already-exists") {
      return res.status(409).json({ error: "El correo ya está registrado." });
    }
    return res.status(500).json({ error: "No se pudo registrar el usuario." });
  }
});

/**
 * Promover usuario (protegido SOLO por API key):
 * - Cambia role/orgId/businessIds en claims y en /users/{uid}.
 * - Útil para flujos de soporte/operaciones.
 */
router.post("/promote", async (req, res) => {
  try {
    const key = req.headers["x-admin-key"];
    if (!key || key !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { email, role = "admin", orgId = "ORG_ABC", businessIds = [] } = req.body;
    if (!email) return res.status(400).json({ error: "email requerido" });

    const user = await admin.auth().getUserByEmail(email);
    const uid = user.uid;

    const claims = {
      role,
      orgId,
      businessIds,
      defaultBusinessId: businessIds[0] || null,
    };
    await admin.auth().setCustomUserClaims(uid, claims);

    await admin.firestore().collection("users").doc(uid).set(
      {
        role,
        orgId,
        businessIds,
        defaultBusinessId: businessIds[0] || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json({ ok: true, uid, email, claims });
  } catch (err) {
    console.error("Promote error:", err);
    res.status(500).json({ error: "No se pudo promover el usuario" });
  }
});

/**
 * (Opcional) Promover a SUPERADMIN por API key.
 * Úsalo solo para bootstrap interno.
 */
router.post("/promote-superadmin", async (req, res) => {
  try {
    const key = req.headers["x-admin-key"];
    if (!key || key !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email requerido" });

    const user = await admin.auth().getUserByEmail(email);
    const uid = user.uid;

    await admin.auth().setCustomUserClaims(uid, { role: "superadmin" });
    await admin.firestore().collection("users").doc(uid).set(
      { role: "superadmin", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    res.json({ ok: true, uid, email, claims: { role: "superadmin" } });
  } catch (err) {
    console.error("promote-superadmin error:", err);
    res.status(500).json({ error: "No se pudo promover a superadmin" });
  }
});

/**
 * Crear/actualizar ADMIN (solo superadmin o API key):
 * - Crea o actualiza un usuario con contraseña.
 * - Lo asigna a una organización y (opcionalmente) a businessIds.
 * - Escribe /users/{uid} como rol "admin".
 * - (Opcional) setea custom claims para futura compatibilidad.
 */
router.post("/create-admin", requireSuperadminOrKey, async (req, res) => {
  try {
    const { email, name, password, orgId, businessIds = [] } = req.body;
    if (!email || !password || !orgId) {
      return res.status(400).json({ error: "email, password y orgId son requeridos" });
    }

    // 1) Crear o actualizar el usuario Auth
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
      userRecord = await admin.auth().updateUser(userRecord.uid, {
        displayName: name || userRecord.displayName || "",
        password,
        disabled: false,
      });
    } catch {
      userRecord = await admin.auth().createUser({
        email,
        password,
        emailVerified: false,
        displayName: name || email.split("@")[0],
        disabled: false,
      });
    }
    const uid = userRecord.uid;

    // 2) Perfil en Firestore
    await admin.firestore().collection("users").doc(uid).set(
      {
        name: name || userRecord.displayName || "",
        email,
        role: "admin",
        orgId,
        businessIds,
        defaultBusinessId: businessIds[0] || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // 3) (Opcional) Claims para compatibilidad futura
    try {
      await admin.auth().setCustomUserClaims(uid, {
        role: "admin",
        orgId,
        businessIds,
        defaultBusinessId: businessIds[0] || null,
      });
    } catch (e) {
      console.warn("No se pudieron setear custom claims (no crítico):", e.message);
    }

    return res.json({
      ok: true,
      uid,
      email,
      orgId,
      businessIds,
      message: "Admin creado/asignado correctamente",
    });
  } catch (err) {
    console.error("create-admin error:", err);
    return res.status(500).json({ error: "No se pudo crear/asignar el admin" });
  }
});

module.exports = router;
