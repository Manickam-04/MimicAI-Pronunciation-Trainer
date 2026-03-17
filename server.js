require('dotenv').config();
const express  = require('express');
const fetch    = require('node-fetch');
const cors     = require('cors');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const MURF_API_KEY = process.env.MURF_API_KEY;

if (!MURF_API_KEY) {
  console.error('\n❌  MURF_API_KEY is missing. Copy .env.example to .env and set your key.\n');
  process.exit(1);
}

app.use(cors());
app.use(express.json());

// Serve the frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

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
