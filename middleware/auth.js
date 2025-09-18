// server/middleware/auth.js
const admin = require("firebase-admin");

async function verifyFirebaseIdToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });

    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded; // { uid, email, ... }
    next();
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
}

module.exports = { verifyFirebaseIdToken };
