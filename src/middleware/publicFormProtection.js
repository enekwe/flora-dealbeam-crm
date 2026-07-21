/**
 * Public Form Protection
 * Rate limiting + honeypot check for the unauthenticated intake-form
 * endpoints (Epic 2.5, MP-2.5-S11).
 */

const rateLimit = require('express-rate-limit');

const HONEYPOT_FIELD = '_hp';

const publicFormRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again shortly.' }
});

// Flags likely-bot submissions instead of rejecting outright, so the route
// can return a normal-looking success response without actually processing
// the submission — rejecting tips bots off to try again with a workaround.
function checkHoneypot(req, res, next) {
  const honeypotValue = req.body?.[HONEYPOT_FIELD];
  req.isSpam = typeof honeypotValue === 'string' && honeypotValue.trim().length > 0;
  next();
}

module.exports = { publicFormRateLimiter, checkHoneypot, HONEYPOT_FIELD };
