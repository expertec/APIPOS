// server/routes/billing.js
const express = require("express");
const admin = require("firebase-admin");
const Stripe = require("stripe");
const { verifyFirebaseIdToken } = require("../middleware/auth");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const router = express.Router();

// util: lee un plan del catálogo
async function readPlan(planId) {
  const snap = await admin.firestore().collection("plans").doc(planId).get();
  if (!snap.exists) throw new Error("plan_not_found");
  return { id: snap.id, ...snap.data() };
}

// POST /api/billing/checkout  { tenantId, planId, interval: "month"|"year" }
router.post("/checkout", verifyFirebaseIdToken, async (req, res) => {
  try {
    const { tenantId, planId, interval = "month" } = req.body || {};
    if (!tenantId || !planId) return res.status(400).json({ error: "tenantId, planId required" });

    // Lee plan y valida precio
    const plan = await readPlan(planId);
    const price = interval === "year" ? plan.prices?.year : plan.prices?.month;
    if (!price || !plan.stripe?.priceIds?.[interval]) {
      return res.status(400).json({ error: "Plan/interval sin precio Stripe" });
    }

    // Crea sesión de checkout
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        { price: plan.stripe.priceIds[interval], quantity: 1 },
      ],
      customer_email: req.user.email, // o busca/crea customer a partir del tenant
      success_url: `${process.env.APP_BASE_URL}/app/settings/billing?success=1`,
      cancel_url: `${process.env.APP_BASE_URL}/app/settings/billing?canceled=1`,
      metadata: {
        tenantId,
        planId,
        interval,
      },
      // si manejas impuestos, trial, cupones, agrégalo aquí
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error("checkout error:", e);
    res.status(500).json({ error: e.message || "error" });
  }
});

// Webhook Stripe: actualiza plan del tenant al confirmar
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("stripe webhook signature failed", err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Puedes manejar: checkout.session.completed, customer.subscription.updated, etc.
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const tenantId = session.metadata?.tenantId;
      const planId = session.metadata?.planId;
      if (tenantId && planId) {
        // "congelar" snapshot del plan actual en companies/{tenant}.plan (priceLocked)
        const planSnap = await admin.firestore().collection("plans").doc(planId).get();
        if (planSnap.exists) {
          const p = planSnap.data();
          await admin.firestore().collection("companies").doc(tenantId).set({
            plan: {
              planId,
              planRef: planSnap.ref.path,
              status: "active",
              startedAt: admin.firestore.FieldValue.serverTimestamp(),
              priceLocked: {
                interval: session.metadata?.interval || "month",
                unit_amount: (session.amount_total ?? 0), // opcional; usa price si prefieres
                currency: (session.currency || "mxn"),
              },
              entitlements: {
                agentsMax: p.limits.agentsMax,
                productsMax: p.limits.productsMax,
                whatsappNumbersMax: p.limits.whatsappNumbersMax,
                automationsMax: p.limits.automationsMax,
                paymentsOnline: p.limits.paymentsOnline,
                website: p.limits.website,
                crm: p.limits.crm,
                brandingRemoved: !!p.features.brandingRemoved,
                support: p.features.support,
              },
            },
          }, { merge: true });
        }
      }
    }

    res.json({ received: true });
  } catch (e) {
    console.error("webhook handle error", e);
    res.status(500).send("webhook error");
  }
});

module.exports = router;
