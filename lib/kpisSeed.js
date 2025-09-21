const admin = require("firebase-admin");
const db = admin.firestore();

const todayKey = () => new Date().toISOString().slice(0,10);
const now = () => Date.now();

async function seedKpisForTenant(tenantId) {
  const base = db.collection("companies").doc(tenantId).collection("kpis");
  const batch = db.batch();
  batch.set(base.doc("summary"), {
    totalSales: 0, totalOrders: 0, totalLeads: 0,
    messagesIn: 0, messagesOut: 0, updatedAt: now()
  }, { merge: true });
  batch.set(base.collection("daily").doc(todayKey()), {
    sales: 0, orders: 0, leads: 0, messagesIn: 0, messagesOut: 0, createdAt: now()
  }, { merge: true });
  await batch.commit();
}
module.exports = { seedKpisForTenant };
