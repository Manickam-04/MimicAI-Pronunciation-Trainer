require('dotenv').config();
const express  = require('express');
const fetch    = require('node-fetch');
const cors     = require('cors');
const path     = require('path');

const multer   = require('multer');
const FormData = require('form-data');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const MURF_API_KEY = process.env.MURF_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!MURF_API_KEY) {
  console.error('\n❌  MURF_API_KEY is missing. Set it in your .env file.\n');
}

// Multer setup for handling audio uploads (memory storage for quick processing)
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// Serve the frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

/* ─────────────────────────────────────────────────────────────
   POST /api/score
   Receives audio file and calculates accuracy using Groq Whisper
───────────────────────────────────────────────────────────── */
app.post('/api/score', upload.single('audio'), async (req, res) => {
  const { targetText, rhythm, volume, language } = req.body;
  const audioBuffer = req.file?.buffer;

  if (!audioBuffer || !targetText) {
    return res.status(400).json({ error: 'Audio and targetText are required' });
  }

  if (!GROQ_API_KEY) {
    console.error('GROQ_API_KEY is not defined in .env');
    return res.status(500).json({ error: 'Groq API key not configured on server' });
  }

  try {
    console.log(`Received scoring request for: "${targetText}". Audio size: ${audioBuffer?.length} bytes. Language: ${language}`);
    
    // 1. Call Groq Whisper API for transcription
    const form = new FormData();
    form.append('file', audioBuffer, { filename: 'speech.mp3', contentType: 'audio/mpeg' });
    form.append('model', 'whisper-large-v3');
    
    // Ensure we send the 2-letter ISO code (e.g., 'ta' for Tamil, 'hi' for Hindi)
    if (language) {
      const isoCode = language.split('-')[0].toLowerCase();
      form.append('language', isoCode);
    }

    console.log(`Calling Groq Whisper API (v3)...`);
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
      console.error('Groq API Error Detail:', JSON.stringify(err, null, 2));
      throw new Error(err.error?.message || `Groq API returned ${groqRes.status}`);
    }

    const groqData = await groqRes.json();
    const transcript = (groqData.text || '').trim();
    console.log(`AI Transcribed (${language}): "${transcript}"`);

    // Clean transcript for comparison
    const clean = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
    const userWords = clean(transcript);
    const targetWords = clean(targetText);

    // If transcript is effectively empty or just "..."
    if (userWords.length === 0) {
      console.log('No clear voice detected in transcript.');
      return res.json({
        overall: 0,
        accuracy: 0,
        rhythm: parseInt(req.body.rhythm) || 0,
        volume: parseInt(req.body.volume) || 0,
        transcript: ''
      });
    }

    // 2. Word matching logic...

    let matches = 0;
    const matchedIndices = new Set();

    userWords.forEach(uw => {
      for (let i = 0; i < targetWords.length; i++) {
        // Match exact or very close word
        if (!matchedIndices.has(i)) {
          const tw = targetWords[i];
          if (tw === uw || (tw.length > 3 && (tw.includes(uw) || uw.includes(tw)))) {
            matches++;
            matchedIndices.add(i);
            break;
          }
        }
      }
    });

    const accuracy = targetWords.length > 0 ? Math.round((matches / targetWords.length) * 100) : 100;

    // 3. Overall weighted score
    // rhythm and volume are sent from frontend (based on WebAudio analysis)
    const r = parseInt(rhythm) || 0;
    const v = parseInt(volume) || 0;
    const overall = Math.round(r * 0.3 + accuracy * 0.5 + v * 0.2);

    res.json({
      overall,
      accuracy,
      rhythm: r,
      volume: v,
      transcript
    });

  } catch (err) {
    console.error('Scoring error:', err);
    res.status(500).json({ error: err.message });
  }
});

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
        'api-key': MURF_API_KEY,          // key never leaves the server
      },
      body: JSON.stringify({
        voiceId,
        text,
        format: 'MP3',
        sampleRate: 48000,
        speed: -10,                        // slightly slower for learners
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

  // extract shorthand e.g. hi-IN -> hi
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

    // Google Translate data[2] has the detected source language
    const detectedLang = data[2];

    // If they typed in English (en), we use the translated output.
    // If they typed in target language already or Google auto-detected target language, we could just return text.
    // Google mostly passes it through if it's already the target lang.
    return res.json({ translatedText: translatedText || text });
  } catch (err) {
    console.error('Translate error:', err);
    return res.status(500).json({ error: 'Translation failed' });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/voices
   Returns the curated voice list (no API key needed client-side)
───────────────────────────────────────────────────────────── */
app.get('/api/voices', (_req, res) => {
  res.json(VOICES);
});

/* ─────────────────────────────────────────────────────────────
   GET /api/phrases
   Returns phrase list per language
───────────────────────────────────────────────────────────── */
app.get('/api/phrases', (_req, res) => {
  res.json(PHRASES);
});

// Catch-all: serve index.html for any unknown route
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅  VoiceMirror running → http://localhost:${PORT}\n`);
});


// ─── Static data (kept server-side, served via /api) ─────────

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
