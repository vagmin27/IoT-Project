const crypto = require('crypto');

/**
 * Middleware to authenticate IoT gateway requests using a server-to-server secret token.
 * Uses a constant-time comparison (crypto.timingSafeEqual) to prevent timing attacks.
 * The secret token must be supplied via the 'x-gateway-secret' header or 'Authorization: Bearer <token>'.
 */
function verifyGatewaySecret(req, res, next) {
  const configuredSecret = process.env.GATEWAY_SECRET;

  if (!configuredSecret) {
    console.error('[GatewayAuth] Critical error: GATEWAY_SECRET is not configured in the environment.');
    return res.status(500).json({
      success: false,
      message: 'Gateway authentication is not configured on the server.',
    });
  }

  // Check 'x-gateway-secret' header first, then Authorization Bearer fallback
  let providedSecret = req.headers['x-gateway-secret'];

  if (!providedSecret) {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      providedSecret = authHeader.slice(7).trim();
    }
  }

  if (!providedSecret) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Missing gateway secret token in x-gateway-secret header.',
    });
  }

  try {
    const configuredBuffer = Buffer.from(configuredSecret, 'utf8');
    const providedBuffer = Buffer.from(providedSecret, 'utf8');

    if (
      configuredBuffer.length !== providedBuffer.length ||
      !crypto.timingSafeEqual(configuredBuffer, providedBuffer)
    ) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Invalid gateway secret token.',
      });
    }

    next();
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Internal error during gateway authentication.',
    });
  }
}

module.exports = { verifyGatewaySecret };
