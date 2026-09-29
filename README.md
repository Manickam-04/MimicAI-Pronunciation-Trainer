# 🗣️ MimicAI – AI Pronunciation Studio

🔗 **Live Demo:** [https://mimicai.onrender.com](https://mimicai.onrender.com)

**MimicAI** is an AI-powered pronunciation training web application designed for both desktop and mobile browsers. It helps users master spoken phrases in 11+ languages by comparing their voice with native speaker speech models, scoring speech accuracy via Groq Whisper AI, and saving practice history and audio recordings to **Neon PostgreSQL Cloud**.

---

## 🚀 Key Features

<<<<<<< HEAD
* **🎨 Modern Studio Theme**: Midnight glassmorphism aesthetic with subtle ambient glows, responsive mobile navigation, dynamic SVG radial score meters, and interactive waveform visualizers.
* **🔐 Full Authentication**:
  * **Email & Password**: Registration and login with `bcryptjs` password hashing and secure JWT session tokens.
  * **Google OAuth**: Fast 1-click Google Sign-In powered by Google Identity Services (GSI).
* **📊 Personal User Dashboard**:
  * Track total practice drills, average accuracy, highest score, and language counts.
  * **Interactive History Feed**: View every phrase attempted, date/time, and score breakdown (Accuracy, Rhythm, Volume).
  * **In-Browser Audio Replay**: Instant streaming playback of past voice recordings directly from Neon PostgreSQL without ephemeral storage loss.
  * **Practice Again**: 1-click loads any historical phrase and target language back into the Trainer.
* **📱 Desktop & Mobile Browser Ready**:
  * Dynamic audio codec detection (`audio/webm;codecs=opus`, `audio/webm`, `audio/mp4`, `audio/aac`) for iOS Safari, Android Chrome, and desktop browsers.
  * Touch-optimized controls and fluid mobile responsive layout.
* **🐘 Neon Serverless PostgreSQL**:
  * Free cloud-hosted database storing user accounts, phrase drills, accuracy scores, and binary audio waveforms (`BYTEA`).
  * Automatic table creation upon server boot.

---
=======
🧠 How It Works:

User enters a word/sentence
System generates or provides a reference pronunciation (using murfAI, converts text-to-speech)
User records their voice
AI model analyzes (converts speech-to-text):
Pronunciation accuracy
Phonetic similarity
Feedback is displayed to the user

💯Scoring process (backend comparision):

-> If user record a empty clip, AI checks and will display the error message.
-> If user's voice is not clear or more background noice was detected, Error message will be displayed.
-> If user speaks completely wrong phase again error message will be displayed after verifying.
-> If user records the perfect audio clip with clear voice and correct or similar phrase, AI will verify the rhythm and accuracy of the clip and display the message with number score out of 100.

🛠️ Tech Stack:

Frontend:
HTML / CSS / JavaScript
>>>>>>> f97201bfedb420c91b80262fccb4ee2050264aa5

## 🛠️ Tech Stack

* **Frontend**: HTML5, Vanilla CSS3 (Custom Glassmorphism Design System), Modern ES6+ JavaScript, Web Audio API, Canvas Waveform Visualizers.
* **Backend**: Node.js & Express.
* **Database**: Neon Serverless PostgreSQL (`pg`).
* **Authentication**: JWT (`jsonwebtoken`), `bcryptjs`, Google Identity Services (`google-auth-library`).
* **AI & Speech**:
  * **Murf Falcon AI**: Native speaker reference voice generation.
  * **Groq Whisper Large v3**: Real-time multi-lingual speech transcription and accuracy matching.
  * **Google Translate API**: Instant bidirectional translation.

<<<<<<< HEAD
---

## ⚙️ Environment Configuration (`.env`)

Create a `.env` file in the project root with the following variables:

```env
# Murf AI Key for native TTS
MURF_API_KEY=your_murf_api_key

# Groq API Key for Whisper speech recognition
GROQ_API_KEY=your_groq_api_key

# Port (defaults to 3000)
PORT=3000

# Neon PostgreSQL connection string (from neon.tech)
DATABASE_URL=postgresql://neondb_owner:password@ep-cool-base-123456.us-east-2.aws.neon.tech/neondb?sslmode=require

# JWT Secret for session signing
JWT_SECRET=your_super_secret_jwt_key

# Google OAuth Client ID (from Google Cloud Console -> APIs & Services -> Credentials)
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
```

---

## 📦 Running Locally

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the development server**:
   ```bash
   npm run dev
   ```

3. **Open the app**:
   Navigate to [http://localhost:3000](http://localhost:3000) in your desktop or mobile browser.

---

## 🌐 Production Deployment (e.g. Render)

1. Connect your GitHub repository to [Render](https://render.com) (or Railway / Fly.io).
2. Set Build Command: `npm install`
3. Set Start Command: `node server.js`
4. In the Render Environment settings, add:
   * `MURF_API_KEY`
   * `GROQ_API_KEY`
   * `DATABASE_URL` (your connection string from [neon.tech](https://neon.tech))
   * `JWT_SECRET`
   * `GOOGLE_CLIENT_ID`
5. Deploy! Neon PostgreSQL automatically stores and streams user audio recordings with zero cloud storage costs and zero data loss across container redeployments.
=======
Deployment:
Render

🎯 Use Cases:

Students improving spoken English
Language learners
Interview preparation
Accent training
Communication skill development

🔮 Future Improvements:

🌍 Multi-language support
🧠 Advanced phoneme-level feedback
📈 Progress tracking dashboard
🎮 Gamification (scores, streaks)

👨‍💻 Author:

Manicka Vinayagam
🔗 GitHub: https://github.com/Manickam-04

Hrushabh
🔗 GitHub: https://github.com/hrushabhbait3685-sketch

⭐ Support:

If you like this project, please give it a ⭐ on GitHub!
>>>>>>> f97201bfedb420c91b80262fccb4ee2050264aa5
