// waMulti.js
const fs = require("fs");
const path = require("path");
const Pino = require("pino");
const QRCode = require("qrcode-terminal");
const admin = require("firebase-admin");

// Soporta ambas instalaciones: "@whiskeysockets/baileys" o "baileys"
let Baileys;
try {
  Baileys = require("@whiskeysockets/baileys");
} catch (e) {
  Baileys = require("baileys");
}
const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  downloadMediaMessage, // opcional si guardarás media
} = Baileys;

// Firestore (admin debe estar inicializado en server.js antes de requerir este módulo)
const db = admin.firestore();

// Carpeta raíz para sesiones
const SESSION_ROOT = process.env.WA_SESSION_ROOT || "/var/data/wa-sessions";

// Mapa in-memory de sesiones: key = `${orgId}:${businessId}`
const sessions = new Map();

function sessKey(orgId, businessId) {
  return `${orgId}:${businessId}`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getAuthDir(orgId, businessId) {
  return path.join(SESSION_ROOT, `${orgId}_${businessId}`);
}

/**
 * Arranca (o reutiliza) una sesión de WhatsApp para un negocio.
 * Crea la carpeta de auth si no existe.
 */
async function startWhatsApp(orgId, businessId) {
  const key = sessKey(orgId, businessId);
  if (sessions.has(key)) {
    return sessions.get(key);
  }

  const authDir = getAuthDir(orgId, businessId);
  ensureDir(authDir);

  // Marca el estado como "starting" en Firestore (opcional pero recomendado)
  try {
    await db
      .collection("orgs").doc(orgId)
      .collection("businesses").doc(businessId)
      .collection("integrations").doc("whatsapp")
      .set(
        { status: "starting", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
  } catch (_) {}

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const logger = Pino({ level: "info" });
  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false, // nosotros gestionamos el QR
    version,
    // browser: ['MakaittoPOS', 'Chrome', '1.0.0'],  // opcional
    syncFullHistory: false,
  });

  const runtime = {
    sock,
    saveCreds,
    authDir,
    status: "connecting",
    qr: null,
    phone: null,
  };
  sessions.set(key, runtime);

  // Eventos de conexión / QR
  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      runtime.qr = qr;
      runtime.status = "qr";
      try {
        QRCode.generate(qr, { small: true }); // útil para logs
      } catch (_) {}
      // Persiste estado "qr"
      db.collection("orgs").doc(orgId)
        .collection("businesses").doc(businessId)
        .collection("integrations").doc("whatsapp")
        .set(
          { status: "qr", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        ).catch(() => {});
    }

    if (connection === "open") {
      runtime.status = "connected";
      runtime.qr = null;
      if (sock.user?.id) {
        runtime.phone = String(sock.user.id).split("@")[0];
      }
      // Guardar estado conectado
      db.collection("orgs").doc(orgId)
        .collection("businesses").doc(businessId)
        .collection("integrations").doc("whatsapp")
        .set(
          {
            status: "connected",
            phone: runtime.phone || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        ).catch(() => {});
    }

    if (connection === "close") {
      const code =
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.error?.status ||
        lastDisconnect?.error?.code;

      runtime.status = "disconnected";

      // loggedOut = el usuario cerró sesión desde el teléfono → borra carpeta y elimina sesión
      if (code === DisconnectReason.loggedOut) {
        try {
          fs.rmSync(authDir, { recursive: true, force: true });
        } catch (_) {}
        sessions.delete(key);
        db.collection("orgs").doc(orgId)
          .collection("businesses").doc(businessId)
          .collection("integrations").doc("whatsapp")
          .set(
            { status: "logged_out", phone: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          ).catch(() => {});
      } else {
        // Intento de reconexión automática
        setTimeout(() => {
          startWhatsApp(orgId, businessId).catch((e) =>
            console.error("reconnect error", e.message)
          );
        }, 3000);
      }
    }
  });

  // Guardar credenciales en disco cuando cambian
  sock.ev.on("creds.update", runtime.saveCreds);

  // Ejemplo: procesar mensajes entrantes (opcional)
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      // Ignora grupos y vacíos
      const jid = msg?.key?.remoteJid;
      if (!jid || jid.endsWith("@g.us")) continue;

      // Texto simple
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        (msg.message ? "[media]" : null);

      // Persistir un log mínimo en Firestore
      try {
        await db
          .collection("orgs").doc(orgId)
          .collection("businesses").doc(businessId)
          .collection("wa_messages")
          .add({
            from: msg.key.fromMe ? "business" : "lead",
            phone: jid.split("@")[0],
            content: text,
            at: admin.firestore.FieldValue.serverTimestamp(),
          });
      } catch (e) {
        console.error("save msg error", e?.message || e);
      }
    }
  });

  return runtime;
}

/**
 * Devuelve el estado/QR/teléfono de la sesión del negocio.
 */
function getStatus(orgId, businessId) {
  const s = sessions.get(sessKey(orgId, businessId));
  if (!s) return { status: "idle", qr: null, phone: null };
  return { status: s.status, qr: s.qr, phone: s.phone || null };
}

/**
 * Envía un texto desde la sesión del negocio a un número.
 * Normaliza un 10 dígitos MX a E.164 (52xxxxxxxxxx) como ejemplo.
 */
async function sendText(orgId, businessId, toPhone, text) {
  const s = sessions.get(sessKey(orgId, businessId));
  if (!s || !s.sock) throw new Error("La sesión no está activa");

  let num = String(toPhone).replace(/\D/g, "");
  if (num.length === 10) num = "52" + num; // ajusta a tu país
  const jid = `${num}@s.whatsapp.net`;

  await s.sock.sendMessage(jid, { text });
  return { ok: true };
}

/**
 * Cierra sesión y borra carpeta de autenticación del negocio.
 */
async function logout(orgId, businessId) {
  const key = sessKey(orgId, businessId);
  const s = sessions.get(key);

  if (s?.sock) {
    try {
      await s.sock.logout?.();
    } catch (_) {}
  }
  // borra carpeta
  try {
    fs.rmSync(s?.authDir || getAuthDir(orgId, businessId), { recursive: true, force: true });
  } catch (_) {}

  sessions.delete(key);

  try {
    await db
      .collection("orgs").doc(orgId)
      .collection("businesses").doc(businessId)
      .collection("integrations").doc("whatsapp")
      .set(
        { status: "logged_out", phone: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
  } catch (_) {}

  return { ok: true };
}

module.exports = {
  startWhatsApp,
  getStatus,
  sendText,
  logout,
};
