// server/lib/kpisSeed.js
const admin = require("firebase-admin");
const db = admin.firestore();

const todayKey = () => new Date().toISOString().slice(0,10);
const now = () => Date.now();

/** Idempotente */
async function seedKpisForTenant(tenantId) {
  const comp = db.collection("companies").doc(tenantId);
  const summaryRef = comp.collection("kpis").doc("summary");
  const dailyRef   = comp.collection("kpis_daily").doc(todayKey());

  const batch = db.batch();
  batch.set(summaryRef, {
    totalSales: 0,
    totalOrders: 0,
    totalLeads: 0,
    messagesIn: 0,
    messagesOut: 0,
    updatedAt: now(),
  }, { merge: true });

  batch.set(dailyRef, {
    sales: 0,
    orders: 0,
    leads: 0,
    messagesIn: 0,
    messagesOut: 0,
    createdAt: now(),
  }, { merge: true });

  await batch.commit();
}

module.exports = { seedKpisForTenant };
