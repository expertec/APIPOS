const path = require('node:path');
const fs = require('node:fs');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

function createBaileysManager({ basePath = './data/wa' } = {}) {
  fs.mkdirSync(basePath, { recursive: true });
  const sessions = new Map(); // tenantId -> client

  function ensure(tenantId) {
    if (!tenantId) tenantId = 'default';
    if (!sessions.has(tenantId)) sessions.set(tenantId, createClient(tenantId));
    return sessions.get(tenantId);
  }

  function createClient(tenantId) {
    let sock = null;
    let subscribers = [];
    let stopping = false;
    let status = { tenantId, state: 'idle' }; // idle|connecting|connected|disconnected|error

    const authDir = path.join(basePath, tenantId);
    fs.mkdirSync(authDir, { recursive: true });

    const notify = (evt) => subscribers.forEach(fn => fn(evt));
    const setStatus = (s) => { status.state = s; notify({ type: 'status', payload: s }); };

    async function start() {
      if (sock) return;
      setStatus('connecting');

      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false,
        browser: ['POS-SaaS','Chrome','1.0'],
        msgRetryCounterCache: new Map(),
      });

      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) notify({ type: 'qr', payload: qr });
        if (connection === 'open') {
          setStatus('connected');
          notify({ type: 'connected', payload: { me: sock.user } });
        }
        if (connection === 'close') {
          const code = (lastDisconnect?.error?.output?.statusCode) || 0;
          sock = null;
          if (!stopping && code !== DisconnectReason.loggedOut) {
            setStatus('disconnected');
            setTimeout(start, 5000);
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
      setStatus('disconnected');
    }

    function subscribe(fn) { subscribers.push(fn); return () => { subscribers = subscribers.filter(s => s !== fn); }; }
    function getStatus() { return status; }

    return { start, logout, subscribe, getStatus };
  }

  return { ensure };
}

module.exports = { createBaileysManager };
