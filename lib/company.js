// server/lib/company.js
const admin = require("firebase-admin");

async function getCompanyPlan(tenantId) {
  const snap = await admin.firestore().collection("companies").doc(tenantId).get();
  if (!snap.exists) throw new Error("company_not_found");
  const data = snap.data() || {};
  if (!data.plan || !data.plan.entitlements) throw new Error("plan_not_configured");
  return { company: data, ent: data.plan.entitlements };
}

module.exports = { getCompanyPlan };
