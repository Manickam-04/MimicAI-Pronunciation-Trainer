require('dotenv').config();
const express  = require('express');
const fetch    = require('node-fetch');
const cors     = require('cors');
const path     = require('path');
const multer   = require('multer');
const FormData = require('form-data');

const db   = require('./db');
const auth = require('./auth');

const app  = express();
const PORT = process.env.PORT || 3000;
const MURF_API_KEY = process.env.MURF_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!MURF_API_KEY) {
  console.warn('\n⚠️  MURF_API_KEY is missing. Set it in your .env file.\n');
}
if (!GROQ_API_KEY) {
  console.warn('\n⚠️  GROQ_API_KEY is missing. Set it in your .env file.\n');
}

// Multer setup for handling audio uploads (memory storage for instant streaming & DB storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB limit
});

app.use(cors());
app.use(express.json());

// Serve static frontend files from /public
app.use(express.static(path.join(__dirname, 'public')));

/* ─────────────────────────────────────────────────────────────
   GET /api/config
   Provides client-side environment configurations
───────────────────────────────────────────────────────────── */
app.get('/api/config', async (_req, res) => {
  require('dotenv').config();
  if (!db.isAvailable()) {
    await db.initDb();
  }
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    hasDatabase: db.isAvailable(),
  });
});

/* ─────────────────────────────────────────────────────────────
   AUTH ROUTES
───────────────────────────────────────────────────────────── */

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const cleanEmail = email.trim().toLowerCase();

  if (!db.isAvailable()) {
    await db.initDb();
  }

  if (!db.isAvailable()) {
    return res.status(503).json({
      error: 'Database is not connected. Please ensure DATABASE_URL is valid in your .env file.'
    });
  }

  try {
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await auth.hashPassword(password);
    const displayName = (name || cleanEmail.split('@')[0]).trim();

    const result = await db.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, avatar_url, created_at`,
      [cleanEmail, passwordHash, displayName]
    );

    const user = result.rows[0];
    const token = auth.generateToken(user);

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to create account: ' + err.message });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const cleanEmail = email.trim().toLowerCase();

  if (!db.isAvailable()) {
    await db.initDb();
  }

  if (!db.isAvailable()) {
    return res.status(503).json({
      error: 'Database is not connected. Please ensure DATABASE_URL is valid in your .env file.'
    });
  }

  try {
    const result = await db.query(
      'SELECT id, email, password_hash, name, avatar_url, created_at FROM users WHERE email = $1',
      [cleanEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    if (!user.password_hash) {
      return res.status(400).json({
        error: 'This account was created with Google Sign-In. Please sign in with Google.'
      });
    }

    const isValid = await auth.comparePassword(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    delete user.password_hash;
    const token = auth.generateToken(user);

    res.json({
      message: 'Logged in successfully',
      token,
      user
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

// POST /api/auth/google
app.post('/api/auth/google', async (req, res) => {
  const { credential, accessToken } = req.body;

  if (!credential && !accessToken) {
    return res.status(400).json({ error: 'Google credential or accessToken is required' });
  }

  if (!db.isAvailable()) {
    await db.initDb();
  }

  if (!db.isAvailable()) {
    return res.status(503).json({
      error: 'Database is not connected. Please ensure DATABASE_URL is valid in your .env file.'
    });
  }

  try {
    const googleProfile = credential 
      ? await auth.verifyGoogleToken(credential)
      : await auth.verifyGoogleAccessToken(accessToken);
    const cleanEmail = googleProfile.email.toLowerCase();

    // Check if user already exists
    let result = await db.query(
      'SELECT id, email, name, avatar_url, google_id, created_at FROM users WHERE email = $1 OR google_id = $2',
      [cleanEmail, googleProfile.googleId]
    );

    let user;
    if (result.rows.length > 0) {
      user = result.rows[0];
      // Update Google ID or avatar if missing
      await db.query(
        `UPDATE users
         SET google_id = COALESCE(google_id, $1),
             avatar_url = COALESCE(avatar_url, $2)
         WHERE id = $3`,
        [googleProfile.googleId, googleProfile.avatar_url, user.id]
      );
      if (googleProfile.avatar_url && !user.avatar_url) {
        user.avatar_url = googleProfile.avatar_url;
      }
    } else {
      // Create new user
      const insertRes = await db.query(
        `INSERT INTO users (email, name, avatar_url, google_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, name, avatar_url, created_at`,
        [cleanEmail, googleProfile.name, googleProfile.avatar_url, googleProfile.googleId]
      );
      user = insertRes.rows[0];
    }

    const token = auth.generateToken(user);

    res.json({
      message: 'Signed in with Google successfully',
      token,
      user
    });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(401).json({ error: 'Google authentication failed: ' + err.message });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', auth.requireAuth, async (req, res) => {
  if (!db.isAvailable()) {
    return res.json({ user: req.user });
  }

  try {
    const result = await db.query(
      'SELECT id, email, name, avatar_url, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Fetch profile error:', err);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// PUT /api/user/name
app.put('/api/user/name', auth.requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name cannot be empty' });
  }

  const cleanName = name.trim().slice(0, 50);

  if (!db.isAvailable()) {
    await db.initDb();
  }

  if (!db.isAvailable()) {
    return res.status(503).json({ error: 'Database is not connected' });
  }

  try {
    const result = await db.query(
      `UPDATE users
       SET name = $1
       WHERE id = $2
       RETURNING id, email, name, avatar_url, created_at`,
      [cleanName, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedUser = result.rows[0];
    const newToken = auth.generateToken(updatedUser);

    res.json({
      message: 'Name updated successfully',
      user: updatedUser,
      token: newToken
    });
  } catch (err) {
    console.error('Update name error:', err);
    res.status(500).json({ error: 'Failed to update name: ' + err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/score
   Receives audio file and calculates accuracy using Groq Whisper.
   If user is authenticated, saves session & recording to Neon DB.
───────────────────────────────────────────────────────────── */
const LANGUAGE_NAMES = {
  'ta-IN': 'Tamil',
  'mr-IN': 'Marathi',
  'hi-IN': 'Hindi',
  'en-IN': 'English',
  'ja-JP': 'Japanese',
  'pt-BR': 'Portuguese',
  'de-DE': 'German',
  'fr-FR': 'French',
  'es-ES': 'Spanish',
  'es-MX': 'Spanish',
  'it-IT': 'Italian',
};

function getLanguageDisplayName(code) {
  return LANGUAGE_NAMES[code] || code || 'the selected language';
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function wordSimilarity(w1, w2) {
  if (!w1 || !w2) return 0;
  if (w1 === w2) return 1.0;
  const maxLen = Math.max(w1.length, w2.length);
  if (maxLen === 0) return 1.0;
  if (maxLen <= 3) return w1 === w2 ? 1.0 : 0.0;
  const dist = levenshtein(w1, w2);
  const sim = 1 - (dist / maxLen);
  return sim >= 0.75 ? sim : 0.0;
}

function detectScriptMismatch(targetText, transcript, languageCode) {
  if (!targetText || !transcript) return { mismatch: false };

  const TAMIL_REGEX = /[\u0B80-\u0BFF]/;
  const DEVANAGARI_REGEX = /[\u0900-\u097F]/;
  const JAPANESE_REGEX = /[\u3040-\u30FF\u4E00-\u9FAF]/;
  const LATIN_REGEX = /[a-zA-Z]/;

  const targetHasTamil = TAMIL_REGEX.test(targetText);
  const targetHasDevanagari = DEVANAGARI_REGEX.test(targetText);
  const targetHasJapanese = JAPANESE_REGEX.test(targetText);
  const targetHasLatin = LATIN_REGEX.test(targetText);

  const transHasTamil = TAMIL_REGEX.test(transcript);
  const transHasDevanagari = DEVANAGARI_REGEX.test(transcript);
  const transHasJapanese = JAPANESE_REGEX.test(transcript);
  const transHasLatin = LATIN_REGEX.test(transcript);

  // If target is Tamil, but spoken transcript has zero Tamil characters and has Latin or Devanagari
  if (targetHasTamil && !transHasTamil && (transHasLatin || transHasDevanagari)) {
    return {
      mismatch: true,
      expected: 'Tamil',
      detected: transHasLatin ? 'English / Latin' : 'Other'
    };
  }

  // If target is Hindi or Marathi (Devanagari), but transcript has zero Devanagari characters
  if (targetHasDevanagari && !transHasDevanagari && (transHasLatin || transHasTamil)) {
    return {
      mismatch: true,
      expected: languageCode === 'mr-IN' ? 'Marathi' : 'Hindi',
      detected: transHasLatin ? 'English / Latin' : 'Other'
    };
  }

  // If target is Japanese, but user transcript has zero Japanese characters
  if (targetHasJapanese && !transHasJapanese && transHasLatin) {
    return {
      mismatch: true,
      expected: 'Japanese',
      detected: 'English / Latin'
    };
  }

  // If target is Latin script, but spoken transcript is in Tamil/Devanagari/Japanese
  if (targetHasLatin && !targetHasTamil && !targetHasDevanagari && !targetHasJapanese) {
    if (transHasTamil || transHasDevanagari || transHasJapanese) {
      return {
        mismatch: true,
        expected: getLanguageDisplayName(languageCode),
        detected: transHasTamil ? 'Tamil' : (transHasDevanagari ? 'Hindi/Marathi' : 'Japanese')
      };
    }
  }

  return { mismatch: false };
}

function isSilenceOrHallucination(transcript, targetText, volume) {
  if (volume !== undefined && volume !== null && volume < 6) return true;
  if (!transcript) return true;
  const t = transcript.trim().toLowerCase().replace(/[.,!?;:—_~'"\[\]()]/g, '').trim();
  if (t.length === 0) return true;

  const targetClean = (targetText || '').toLowerCase().replace(/[.,!?;:—_~'"\[\]()]/g, '').trim();

  const SILENCE_HALLUCINATIONS = [
    'thank you for watching',
    'thanks for watching',
    'thank you very much for watching',
    'please subscribe',
    'subscribe to my channel',
    'subscribe',
    'subtitles by',
    'subtitles by the amara org community',
    'amara org',
    'mbc',
    'bye',
    'goodbye',
    'silence',
    'music',
    'applause'
  ];

  for (const h of SILENCE_HALLUCINATIONS) {
    if (t === h && !targetClean.includes(h)) return true;
  }

  if ((t === 'you' || t === 'thank you') && !targetClean.includes(t)) {
    return true;
  }

  return false;
}

/* ─────────────────────────────────────────────────────────────
   POST /api/score
   Receives audio file and calculates accuracy using Groq Whisper.
   Enforces strict language matching, silence detection, and similarity.
   If user is authenticated and score > 0, saves session to Neon DB.
───────────────────────────────────────────────────────────── */
app.post('/api/score', auth.optionalAuth, upload.single('audio'), async (req, res) => {
  const { targetText, rhythm, volume, language, translation, voiceId } = req.body;
  const audioBuffer = req.file?.buffer;
  const mimeType = req.file?.mimetype || 'audio/webm';

  if (!audioBuffer || !targetText) {
    return res.status(400).json({ error: 'Audio and targetText are required' });
  }

  if (!GROQ_API_KEY) {
    console.error('GROQ_API_KEY is not defined in .env');
    return res.status(500).json({ error: 'Groq API key not configured on server' });
  }

  try {
    const r = parseInt(rhythm) || 0;
    const v = parseInt(volume) || 0;
    console.log(`Scoring request for: "${targetText}". Audio size: ${audioBuffer.length} bytes. Lang: ${language}. Vol: ${v}`);

    // 1. Instant Silence Guard: If audio volume is below audible voice threshold (pure silence/muted)
    if (v < 6) {
      console.log(`🔇 Instant silence detected (volume=${v})`);
      return res.json({
        overall: 0,
        accuracy: 0,
        rhythm: 0,
        volume: v,
        transcript: '',
        isSilence: true,
        message: 'Voice not detected'
      });
    }

    // Transcribe with Groq Whisper
    const transcript = await transcribeAudio(audioBuffer, language);
    console.log(`AI Transcribed (${language}): "${transcript}"`);

    // 2. Silence Hallucination Guard (handles empty text or Whisper phantom tokens on low noise)
    if (isSilenceOrHallucination(transcript, targetText, v)) {
      console.log(`🔇 Silence / non-voice detected (vol=${v}, transcript="${transcript}")`);
      return res.json({
        overall: 0,
        accuracy: 0,
        rhythm: 0,
        volume: v,
        transcript: transcript || '',
        isSilence: true,
        message: 'Voice not detected'
      });
    }

    // 2. Language Script Mismatch Guard
    const scriptCheck = detectScriptMismatch(targetText, transcript, language);
    if (scriptCheck.mismatch) {
      console.log(`⚠️ Language mismatch: Expected ${scriptCheck.expected}, but heard ${scriptCheck.detected} ("${transcript}")`);
      return res.json({
        overall: 0,
        accuracy: 0,
        rhythm: 0,
        volume: v,
        transcript,
        languageMismatch: true,
        expectedLanguage: scriptCheck.expected,
        message: `Please record in ${scriptCheck.expected}.`
      });
    }

    // 3. Clean and Segment Words for Evaluation
    const cleanStr = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim();
    const cleanTarget = cleanStr(targetText);
    const cleanTranscript = cleanStr(transcript);
    const targetWords = cleanTarget.split(/\s+/).filter(Boolean);
    const userWords = cleanTranscript.split(/\s+/).filter(Boolean);

    let accuracy = 0;

    // Handle scripts without word spaces (e.g. Japanese)
    if (targetWords.length <= 1 && cleanTarget.length > 3) {
      const fullDist = levenshtein(cleanTarget, cleanTranscript);
      const maxL = Math.max(cleanTarget.length, cleanTranscript.length);
      const fullSim = 1 - (fullDist / maxL);
      if (fullSim >= 0.40) {
        accuracy = Math.round(fullSim * 100);
      } else {
        accuracy = 0;
      }
    } else if (targetWords.length > 0 && userWords.length > 0) {
      let totalMatchedScore = 0;
      const usedUserIndices = new Set();

      for (let i = 0; i < targetWords.length; i++) {
        const tw = targetWords[i];
        let bestSim = 0;
        let bestUserIdx = -1;

        for (let j = 0; j < userWords.length; j++) {
          if (usedUserIndices.has(j)) continue;
          const sim = wordSimilarity(tw, userWords[j]);
          if (sim > bestSim) {
            bestSim = sim;
            bestUserIdx = j;
          }
        }

        if (bestSim >= 0.75 && bestUserIdx !== -1) {
          totalMatchedScore += bestSim;
          usedUserIndices.add(bestUserIdx);
        }
      }

      let rawAccuracy = (totalMatchedScore / targetWords.length) * 100;

      // Precision check: apply penalty if user spoke far too many extra extraneous words
      if (userWords.length > targetWords.length) {
        const lengthPenalty = Math.max(0.2, (targetWords.length / userWords.length) * 1.5);
        rawAccuracy = rawAccuracy * Math.min(1.0, lengthPenalty);
      }

      accuracy = Math.round(rawAccuracy);

      // If accuracy is below 25%, the user spoke a fundamentally different phrase
      if (accuracy < 25) {
        accuracy = 0;
      }
    }

    // 4. Calculate Overall Score: Accuracy is strictly required
    let overall = 0;
    if (accuracy > 0) {
      const accWeight = accuracy / 100;
      overall = Math.round(accuracy * 0.6 + (r * 0.25 + v * 0.15) * accWeight);
      overall = Math.max(1, Math.min(100, overall));
    } else {
      overall = 0;
    }

    let savedSessionId = null;

    // 5. Persist to Neon Postgres ONLY if practice attempt has positive accuracy
    if (req.user && db.isAvailable() && accuracy > 0) {
      try {
        const sessionRes = await db.query(
          `INSERT INTO practice_sessions
           (user_id, phrase, translation, language, voice_id, overall_score, accuracy, rhythm, volume, transcript, audio_data, audio_mimetype)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id`,
          [
            req.user.id,
            targetText,
            translation || null,
            language || 'en',
            voiceId || null,
            overall,
            accuracy,
            r,
            v,
            transcript || null,
            audioBuffer,
            mimeType
          ]
        );
        savedSessionId = sessionRes.rows[0]?.id;
        console.log(`✅ Saved practice session #${savedSessionId} for user ${req.user.email} (score: ${overall}%)`);
      } catch (dbErr) {
        console.error('Error saving session to DB:', dbErr.message);
      }
    }

    res.json({
      overall,
      accuracy,
      rhythm: accuracy > 0 ? r : 0,
      volume: v,
      transcript,
      savedSessionId,
      phraseMismatch: accuracy === 0
    });

  } catch (err) {
    console.error('Scoring error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/history
   Returns practice session history & stats for the logged-in user
───────────────────────────────────────────────────────────── */
app.get('/api/history', auth.requireAuth, async (req, res) => {
  if (!db.isAvailable()) {
    return res.status(503).json({ error: 'Database is not connected' });
  }

  const userId = req.user.id;
  const lang = req.query.lang;
  const search = req.query.search;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;

  try {
    // 1. Overall stats
    const statsRes = await db.query(
      `SELECT
        COUNT(*) as total_practices,
        COALESCE(ROUND(AVG(overall_score)), 0) as avg_score,
        COALESCE(MAX(overall_score), 0) as best_score,
        COUNT(DISTINCT language) as languages_count
       FROM practice_sessions
       WHERE user_id = $1`,
      [userId]
    );

    // 2. Query history list (excluding heavy binary audio_data for fast response)
    let queryText = `
      SELECT
        id, phrase, translation, language, voice_id,
        overall_score, accuracy, rhythm, volume, transcript,
        (audio_data IS NOT NULL) as has_recording,
        created_at
      FROM practice_sessions
      WHERE user_id = $1
    `;
    const params = [userId];

    if (lang && lang !== 'all') {
      params.push(lang);
      queryText += ` AND language = $${params.length}`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      queryText += ` AND (LOWER(phrase) LIKE $${params.length} OR LOWER(COALESCE(translation, '')) LIKE $${params.length})`;
    }

    queryText += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const historyRes = await db.query(queryText, params);

    res.json({
      stats: {
        totalPractices: parseInt(statsRes.rows[0]?.total_practices) || 0,
        avgScore: parseInt(statsRes.rows[0]?.avg_score) || 0,
        bestScore: parseInt(statsRes.rows[0]?.best_score) || 0,
        languagesCount: parseInt(statsRes.rows[0]?.languages_count) || 0,
      },
      history: historyRes.rows
    });

  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve history: ' + err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/recordings/:id
   Streams the stored audio recording directly from Neon PostgreSQL
───────────────────────────────────────────────────────────── */
app.get('/api/recordings/:id', auth.optionalAuth, async (req, res) => {
  if (!db.isAvailable()) {
    return res.status(503).json({ error: 'Database is not connected' });
  }

  const sessionId = parseInt(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }

  try {
    const result = await db.query(
      'SELECT audio_data, audio_mimetype, user_id FROM practice_sessions WHERE id = $1',
      [sessionId]
    );

    if (result.rows.length === 0 || !result.rows[0].audio_data) {
      return res.status(404).json({ error: 'Audio recording not found' });
    }

    const { audio_data, audio_mimetype } = result.rows[0];

    res.set({
      'Content-Type': audio_mimetype || 'audio/webm',
      'Content-Length': audio_data.length,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
    });

    res.send(audio_data);
  } catch (err) {
    console.error('Streaming recording error:', err);
    res.status(500).json({ error: 'Failed to stream audio recording' });
  }
});

/* ─────────────────────────────────────────────────────────────
   DELETE /api/history/:id
   Deletes a specific practice session
───────────────────────────────────────────────────────────── */
app.delete('/api/history/:id', auth.requireAuth, async (req, res) => {
  if (!db.isAvailable()) {
    return res.status(503).json({ error: 'Database is not connected' });
  }

  const sessionId = parseInt(req.params.id);
  try {
    const result = await db.query(
      'DELETE FROM practice_sessions WHERE id = $1 AND user_id = $2 RETURNING id',
      [sessionId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or unauthorized' });
    }

    res.json({ message: 'Recording deleted successfully' });
  } catch (err) {
    console.error('Delete history error:', err);
    res.status(500).json({ error: 'Failed to delete recording' });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/transcribe
   Receives audio file and returns text (auto-detect language)
   Used for the "Type your own" voice input
───────────────────────────────────────────────────────────── */
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  const audioBuffer = req.file?.buffer;
  console.log(`Transcribe request received. Audio size: ${audioBuffer?.length || 0} bytes. Mimetype: ${req.file?.mimetype}`);

  if (!audioBuffer) {
    return res.status(400).json({ error: 'Audio is required' });
  }

  try {
    const transcript = await transcribeAudio(audioBuffer);
    res.json({ transcript });
  } catch (err) {
    console.error('Transcription error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Helper to call Groq Whisper API
 */
async function transcribeAudio(audioBuffer, language = null) {
  if (!GROQ_API_KEY) throw new Error('Groq API key not configured');

  const form = new FormData();
  form.append('file', audioBuffer, { filename: 'speech.webm', contentType: 'audio/webm' });
  form.append('model', 'whisper-large-v3');

  if (language) {
    const isoCode = language.split('-')[0].toLowerCase();
    form.append('language', isoCode);
  }

  const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  if (!groqRes.ok) {
    const err = await groqRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Groq API returned ${groqRes.status}`);
  }

  const groqData = await groqRes.json();
  return (groqData.text || '').trim();
}

/* ─────────────────────────────────────────────────────────────
   POST /api/tts
   Body: { voiceId: string, text: string }
   Returns: { audioUrl: string, durationMillis: number }
───────────────────────────────────────────────────────────── */
app.post('/api/tts', async (req, res) => {
  const { voiceId, text } = req.body;

  if (!voiceId || !text) {
    return res.status(400).json({ error: 'voiceId and text are required' });
  }
  if (text.length > 200) {
    return res.status(400).json({ error: 'Text too long (max 200 chars)' });
  }

  try {
    const murfRes = await fetch('https://api.murf.ai/v1/speech/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': MURF_API_KEY,
      },
      body: JSON.stringify({
        voiceId,
        text,
        format: 'MP3',
        sampleRate: 48000,
        speed: -10,
      }),
    });

    if (!murfRes.ok) {
      const errBody = await murfRes.json().catch(() => ({}));
      console.error('Murf API error:', murfRes.status, errBody);
      return res.status(murfRes.status).json({
        error: errBody.message || `Murf API returned ${murfRes.status}`,
      });
    }

    const data = await murfRes.json();

    return res.json({
      audioUrl:       data.audioFile,
      durationMillis: data.audioLengthMillis ?? null,
    });

  } catch (err) {
    console.error('Server error calling Murf:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/translate
   Translates English text to target selected language
───────────────────────────────────────────────────────────── */
app.post('/api/translate', async (req, res) => {
  const { text, targetLang } = req.body;
  if (!text || !targetLang) return res.status(400).json({ error: 'text and targetLang required' });

  const tl = targetLang.split('-')[0];

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
    const trRes = await fetch(url);
    if (!trRes.ok) throw new Error('Translate API returned ' + trRes.status);
    const data = await trRes.json();

    let translatedText = '';
    if (data && data[0]) {
      data[0].forEach(part => {
        if (part[0]) translatedText += part[0];
      });
    }

    const result = (translatedText || text).trim();
    console.log(`Translation Result [${tl}]: "${text}" -> "${result}"`);
    return res.json({ translatedText: result });
  } catch (err) {
    console.error('Translate error:', err);
    return res.status(500).json({ error: 'Translation failed' });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/voices
───────────────────────────────────────────────────────────── */
app.get('/api/voices', (_req, res) => {
  res.json(VOICES);
});

/* ─────────────────────────────────────────────────────────────
   GET /api/phrases
───────────────────────────────────────────────────────────── */
app.get('/api/phrases', (_req, res) => {
  res.json(PHRASES);
});

// Catch-all: serve index.html for any frontend SPA navigation
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server and initialize PostgreSQL
async function start() {
  await db.initDb();
  app.listen(PORT, () => {
    console.log(`\n🚀  MimicAI running → http://localhost:${PORT}\n`);
  });
}

start();

// ─── Static data ─────────────────────────────────────────────

const VOICES = {
  'es-ES': [
    { id: 'es-ES-carla',  name: 'Carla (F)' },
    { id: 'es-ES-elvira', name: 'Elvira (F)' },
  ],
  'es-MX': [
    { id: 'es-MX-alejandro', name: 'Alejandro (M)' },
    { id: 'es-MX-valeria',   name: 'Valeria (F)' },
  ],
  'fr-FR': [
    { id: 'fr-FR-adélie', name: 'Adélie (F)' },
    { id: 'fr-FR-maxime', name: 'Maxime (M)' },
  ],
  'de-DE': [
    { id: 'de-DE-josephine', name: 'Josephine (F)' },
    { id: 'de-DE-erna',      name: 'Erna (F)' },
  ],
  'ja-JP': [
    { id: 'ja-JP-denki', name: 'Denki (M)' },
    { id: 'ja-JP-kenji', name: 'Kenji (M)' },
  ],
  'hi-IN': [
    { id: 'hi-IN-rahul',  name: 'Rahul (M)' },
    { id: 'hi-IN-shweta', name: 'Shweta (F)' },
  ],
  'pt-BR': [
    { id: 'pt-BR-isadora', name: 'Isadora (F)' },
    { id: 'pt-BR-benício', name: 'Benício (M)' },
  ],
  'it-IT': [
    { id: 'it-IT-giorgio',  name: 'Giorgio (M)' },
    { id: 'it-IT-vincenzo', name: 'Vincenzo (M)' },
  ],
  'en-IN': [
    { id: 'en-IN-isha',  name: 'Isha (F)' },
    { id: 'en-IN-arohi', name: 'Arohi (F)' },
  ],
  'ta-IN': [
    { id: 'ta-IN-sarvesh', name: 'Sarvesh (M)' },
    { id: 'ta-IN-suresh',  name: 'Suresh (M)' },
  ],
  'mr-IN': [
    { id: 'hi-IN-shweta', name: 'Shweta (Female, fallback)' },
    { id: 'hi-IN-rahul',  name: 'Rahul (Male, fallback)' },
  ],
};

const PHRASES = {
  'es-ES': [
    'Buenos días, ¿cómo estás?',
    'Me llamo mucho gusto.',
    'Por favor, ¿dónde está el baño?',
    '¿Cuánto cuesta esto?',
    'Muchas gracias por todo.',
  ],
  'es-MX': [
    'Órale, ¿qué onda?',
    'Chido, nos vemos luego.',
    '¿Me puede dar la cuenta?',
    'Está muy rico el tamal.',
    'No manches, qué bueno.',
  ],
  'fr-FR': [
    'Bonjour, comment allez-vous?',
    "S'il vous plaît, où est la gare?",
    'Je voudrais un café, merci.',
    "C'est très beau ici.",
    'Enchanté de faire votre connaissance.',
  ],
  'de-DE': [
    'Guten Morgen, wie geht es Ihnen?',
    'Entschuldigung, wo ist der Bahnhof?',
    'Ich hätte gerne ein Bier, bitte.',
    'Das ist sehr schön hier.',
    'Vielen Dank für alles.',
  ],
  'ja-JP': [
    'おはようございます。',
    'すみません、駅はどこですか？',
    'これはいくらですか？',
    'ありがとうございます。',
    'よろしくお願いします。',
  ],
  'hi-IN': [
    'नमस्ते, आप कैसे हैं?',
    'यह कितने का है?',
    'कृपया यहाँ रुकिए।',
    'बहुत धन्यवाद।',
    'मुझे हिंदी सीखनी है।',
  ],
  'pt-BR': [
    'Bom dia, tudo bem?',
    'Onde fica o banheiro, por favor?',
    'Quanto custa isso?',
    'Muito obrigado pela ajuda.',
    'É muito gostoso esse prato.',
  ],
  'it-IT': [
    'Buongiorno, come sta?',
    'Scusi, dove si trova il museo?',
    'Un caffè, per favore.',
    'Quanto costa questo?',
    'Grazie mille per tutto.',
  ],
  'en-IN': [
    'Hello, how are you?',
    'How much does this cost?',
    'Please stop here.',
    'Thank you very much!',
    'I want to learn English.',
  ],
  'ta-IN': [
    'வணக்கம், நீங்கள் எப்படி இருக்கிறீர்கள்?',
    'இதனுடைய விலை என்ன?',
    'தயவுசெய்து இங்கே நிற்கவும்.',
    'மிக்க நன்றி.',
    'எனக்கு தமிழ் கற்க வேண்டும்.',
  ],
  'mr-IN': [
    'नमस्कार, तुम्ही कसे आहात?',
    'हे कितीला आहे?',
    'कृपया इथे थांबा.',
    'खूप खूप धन्यवाद.',
    'मला मराठी शिकायची आहे.',
  ],
};
