const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fetch = require('node-fetch');
const { OAuth2Client } = require('google-auth-library');

const JWT_SECRET = process.env.JWT_SECRET || 'mimicai_jwt_secret_dev_key_2026_secure';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatar_url,
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// Optional auth middleware: sets req.user if valid token provided, but doesn't block guests
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  const decoded = verifyToken(token);
  req.user = decoded || null;
  next();
}

// Required auth middleware: rejects if no valid token
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Session expired or invalid. Please sign in again.' });
  }

  req.user = decoded;
  next();
}

async function verifyGoogleToken(idToken) {
  if (!idToken) throw new Error('Google ID token is required');

  if (googleClient && GOOGLE_CLIENT_ID) {
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      return {
        googleId: payload.sub,
        email: payload.email,
        name: payload.name || payload.email.split('@')[0],
        avatar_url: payload.picture || null,
      };
    } catch (err) {
      console.warn('Google client verification error, trying tokeninfo fallback:', err.message);
    }
    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name || payload.email.split('@')[0],
      avatar_url: payload.picture || null,
    };
  }

  // Fallback: Verify via Google TokenInfo API (works reliably in production & dev)
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Google token validation failed: ${errorBody}`);
  }

  const payload = await res.json();
  if (!payload.email) {
    throw new Error('Google token did not contain an email address');
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name || payload.email.split('@')[0],
    avatar_url: payload.picture || null,
  };
}

async function verifyGoogleAccessToken(accessToken) {
  if (!accessToken) throw new Error('Access token is required');

  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Google userinfo failed: ${errorBody}`);
  }

  const payload = await res.json();
  if (!payload.email) {
    throw new Error('Google profile did not contain an email address');
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name || payload.email.split('@')[0],
    avatar_url: payload.picture || null,
  };
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = {
  generateToken,
  verifyToken,
  optionalAuth,
  requireAuth,
  verifyGoogleToken,
  verifyGoogleAccessToken,
  hashPassword,
  comparePassword,
};
