// wa/manager.js
const path = require('node:path');
const fs = require('node:fs');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

/**
 * Manager multi-tenant de sesiones de Baileys.
 * - Un cliente por tenantId.
 * - Persistencia en disco usando useMultiFileAuthState(basePath/tenantId).
 */
function createBaileysManager({ basePath = './data/wa' } = {}) {
  fs.mkdirSync(basePath, { recursive: true });

  /** @type {Map<string, ReturnType<typeof createClient>>} */
  const sessions = new Map(); // tenantId -> client

  function ensure(tenantId) {
    const id = tenantId || 'default';
    if (!sessions.has(id)) sessions.set(id, createClient(id));
    return sessions.get(id);
  }

  function createClient(tenantId) {
    let sock = null;
    let subscribers = [];
    let stopping = false;
    let status = { tenantId, state: 'idle' }; // 'idle'|'connecting'|'connected'|'disconnected'|'error'
    let lastQr = null; // último QR emitido por Baileys (string)

    const authDir = path.join(basePath, tenantId);
    fs.mkdirSync(authDir, { recursive: true });

    const notify = (evt) => { for (const fn of subscribers) fn(evt); };
    const setStatus = (s) => {
      status.state = s;
      notify({ type: 'status', payload: s });
    };

    async function start() {
      stopping = false;
      if (sock) return; // ya iniciado
      setStatus('connecting');

      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false,
        browser: ['POS-SaaS', 'Chrome', '1.0'],
        msgRetryCounterCache: new Map(),
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;

        if (qr) {
          lastQr = qr;
          notify({ type: 'qr', payload: qr });
        }

        if (connection === 'open') {
          setStatus('connected');
          lastQr = null;
          notify({ type: 'connected', payload: { me: sock.user } });
        }

        if (connection === 'close') {
          const code = (lastDisconnect?.error?.output?.statusCode) || 0;
          sock = null;

          if (!stopping && code !== DisconnectReason.loggedOut) {
            setStatus('disconnected');
            setTimeout(start, 5000); // reintento
          } else {
            setStatus('disconnected');
          }
        }
      });

      sock.ev.on('messages.upsert', (m) => {
        const msg = m.messages?.[0];
        if (!msg?.key?.remoteJid) return;
        notify({ type: 'message', payload: { tenantId, msg } });
      });
    }

    async function logout() {
      stopping = true;
      try { await sock?.logout(); } catch {}
      sock = null;
      lastQr = null;
      setStatus('disconnected');
    }

    // 🔹 NUEVO: envío de texto
    async function sendText(to, text) {
      if (!sock) throw new Error('not-started');
      // normaliza: solo dígitos y agrega dominio si falta
      const jid = to.includes('@') ? to : `${String(to).replace(/\D/g, '')}@s.whatsapp.net`;
      return sock.sendMessage(jid, { text });
    }

    function subscribe(fn) {
      subscribers.push(fn);
      return () => { subscribers = subscribers.filter((s) => s !== fn); };
    }

    function getStatus() {
      return { ...status, lastQr };
    }

    // 👉 agrega sendText en el return
    return { start, logout, sendText, subscribe, getStatus };
  }

  return { ensure };
}

module.exports = { createBaileysManager };
