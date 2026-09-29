require('dotenv').config();
const { Pool } = require('pg');

let pool = null;
let isConnected = false;

function getOrInitPool() {
  require('dotenv').config();
  const dbUrl = process.env.DATABASE_URL && process.env.DATABASE_URL.trim();
  if (!dbUrl) {
    return null;
  }

  if (!pool) {
    try {
      pool = new Pool({
        connectionString: dbUrl,
        ssl: {
          rejectUnauthorized: false
        },
        connectionTimeoutMillis: 10000,
      });

      pool.on('error', (err) => {
        console.error('Unexpected Neon idle client error:', err.message);
      });
    } catch (err) {
      console.error('⚠️  Failed to initialize PostgreSQL pool:', err.message);
      pool = null;
    }
  }

  return pool;
}

// Initial pool creation attempt
getOrInitPool();

async function initDb() {
  const currentPool = getOrInitPool();
  if (!currentPool) {
    console.warn('⚠️  DATABASE_URL is not defined in .env.');
    isConnected = false;
    return false;
  }

  try {
    const client = await currentPool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255),
          name VARCHAR(255),
          avatar_url TEXT,
          google_id VARCHAR(255) UNIQUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS practice_sessions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          phrase TEXT NOT NULL,
          translation TEXT,
          language VARCHAR(20) NOT NULL,
          voice_id VARCHAR(100),
          overall_score INTEGER DEFAULT 0,
          accuracy INTEGER DEFAULT 0,
          rhythm INTEGER DEFAULT 0,
          volume INTEGER DEFAULT 0,
          transcript TEXT,
          audio_data BYTEA,
          audio_mimetype VARCHAR(50) DEFAULT 'audio/webm',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON practice_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON practice_sessions(created_at DESC);
      `);
      isConnected = true;
      console.log('✅  Connected to Neon PostgreSQL & initialized tables successfully.');
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌  Neon PostgreSQL connection error:', err.message);
    isConnected = false;
    return false;
  }
}

async function query(text, params) {
  const currentPool = getOrInitPool();
  if (!currentPool) {
    throw new Error('Database is not configured. Please set DATABASE_URL in .env');
  }
  return currentPool.query(text, params);
}

module.exports = {
  get pool() { return pool; },
  query,
  initDb,
  isAvailable: () => isConnected && !!pool,
};
