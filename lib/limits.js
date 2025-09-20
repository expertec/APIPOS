// lib/limits.js
function isWithinLimit(currentCount, max) {
  if (typeof max !== "number") return true;
  if (max < 0) return true; // ilimitado
  return currentCount < max;
}

function limitError(feature, requiresPlan, details) {
  const err = new Error("limit_exceeded");
  err.code = 403;
  err.payload = { error: "limit_exceeded", feature, requiresPlan, details };
  return err;
}

module.exports = { isWithinLimit, limitError };
