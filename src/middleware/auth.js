/**
 * Auth Middleware
 * Verifies the Flora session JWT (Bearer token) issued by passbook-flora and
 * attaches { id, organizationId, roles } to req.user. Mirrors the Bearer/JWT
 * convention used across Flora microservices.
 */

const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      id: payload.sub || payload.id,
      organizationId: payload.organizationId,
      roles: payload.roles || (payload.role ? [payload.role] : [])
    };

    if (!req.user.organizationId) {
      return res.status(401).json({ error: 'Token missing organizationId claim' });
    }

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    next(error);
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const roles = req.user?.roles || [];
    const hasRole = roles.some((role) => allowedRoles.includes(role));

    if (!hasRole) {
      return res.status(403).json({ error: 'Insufficient role', required: allowedRoles });
    }

    next();
  };
}

module.exports = { requireAuth, requireRole };
