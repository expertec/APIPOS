// server/routes/invitations.js
const express = require("express");
const crypto = require("crypto");
const admin = require("firebase-admin");

const db = admin.firestore();
const router = express.Router();

/** helper: verifica que req.user.uid sea owner del tenant */
async function assertOwner(tenantId, uid) {
  const snap = await db.collection("companies").doc(tenantId).get();
  if (!snap.exists) throw Object.assign(new Error("Company not found"), { code: 404 });
  const ownerUid = snap.get("ownerUid");
  if (ownerUid !== uid) throw Object.assign(new Error("Forbidden"), { code: 403 });
}

/** POST /api/admin/invitations  (crea invitación)
 * body: { tenantId, email, role }
 * header: Authorization: Bearer <idToken>
 */
router.post("/", async (req, res) => {
  try {
    const { tenantId, email, role = "agent" } = req.body || {};
    if (!tenantId || !email) return res.status(400).json({ error: "tenantId & email required" });

    await assertOwner(tenantId, req.user.uid);

    const inviteId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)); // 7 días

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

    // Devuelve el link para que lo envíes por correo o copies
    const appBase = process.env.APP_BASE_URL || "https://negociosweb.mx";
    const link = `${appBase}/accept-invite?tenant=${encodeURIComponent(tenantId)}&inviteId=${inviteId}&token=${token}`;
    res.json({ ok: true, inviteId, link });
  } catch (e) {
    const code = e.code || 500;
    res.status(code).json({ error: e.message || "error" });
  }
});

/** POST /api/admin/invitations/accept
 * body: { tenantId, inviteId, token }
 * header: Authorization: Bearer <idToken del usuario que acepta>
 */
router.post("/accept", async (req, res) => {
  try {
    const { tenantId, inviteId, token } = req.body || {};
    if (!tenantId || !inviteId || !token) return res.status(400).json({ error: "tenantId, inviteId, token required" });

    const invRef = db.collection("companies").doc(tenantId).collection("invitations").doc(inviteId);
    const invSnap = await invRef.get();
    if (!invSnap.exists) return res.status(404).json({ error: "Invitation not found" });

    const inv = invSnap.data();
    if (inv.status !== "pending" || inv.token !== token) return res.status(403).json({ error: "Invalid invitation" });
    if (inv.expiresAt.toMillis() < Date.now()) return res.status(410).json({ error: "Invitation expired" });

    // El email del usuario autenticado debe coincidir
    const userEmail = (req.user.email || "").toLowerCase();
    if (!userEmail || userEmail !== String(inv.email).toLowerCase()) {
      return res.status(403).json({ error: "Email mismatch" });
    }

    // Crea membresía
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

    res.json({ ok: true });
  } catch (e) {
    const code = e.code || 500;
    res.status(code).json({ error: e.message || "error" });
  }
});

module.exports = router;
