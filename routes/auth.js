// routes/auth.js
const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");

/**
 * ⚠️ Seguridad temporal:
 * - Si permites auto-registro, crea usuarios con role "agent".
 * - Para roles "admin", mejor protégelo con API key o aprobación manual.
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
      password
    });

    const uid = userRecord.uid;

    // 2) Claims por defecto
    const claims = {
      role: "agent",
      orgId: "ORG_ABC",
      businessIds: ["BIZ_01"],
      defaultBusinessId: "BIZ_01"
    };

    await admin.auth().setCustomUserClaims(uid, claims);

    // 3) Guardar perfil en Firestore
    await admin.firestore().collection("users").doc(uid).set({
      name,
      email,
      role: claims.role,
      orgId: claims.orgId,
      businessIds: claims.businessIds,
      defaultBusinessId: claims.defaultBusinessId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 4) Crear custom token
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

module.exports = router;
