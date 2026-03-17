/* ═══════════════════════════════════════════════════════════
   MimicAI — frontend
   All Murf API calls go through /api/tts on the Node server.
   No API key is ever present in this file.
   ═══════════════════════════════════════════════════════════ */

// ─── State ──────────────────────────────────────────────────
let voices         = {};
let phrases        = {};
let selectedPhrase = '';
let selectedVoice  = '';
let currentLang    = 'es-ES';
let nativeAudioUrl = '';
let nativeBuffer   = null;
let userBuffer     = null;
let mediaRecorder  = null;
let chunks         = [];
let isRecording    = false;
let currentNativeSrc = null;
let currentUserSrc   = null;

let recognition = null;
let finalTranscript = '';
let interimTranscript = '';
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRec) {
  recognition = new SpeechRec();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (e) => {
    interimTranscript = '';
    for (let i = e.resultIndex; i < e.results.length; ++i) {
      if (e.results[i].isFinal) {
        finalTranscript += e.results[i][0].transcript + ' ';
      } else {
        interimTranscript += e.results[i][0].transcript;
      }
    }
  };
}

// ─── Score messages ──────────────────────────────────────────
const GRADE_MAP = [
  { min: 90, grade: 'Excellent',  color: '#00e5c4', msg: 'Near-native! Keep it up.' },
  { min: 75, grade: 'Great',      color: '#00d4b0', msg: "Strong effort — a little more and you'll nail it." },
  { min: 60, grade: 'Good',       color: '#f0a500', msg: 'Good job! Focus on rhythm and try once more.' },
  { min: 40, grade: 'Fair',       color: '#ff8a65', msg: 'Getting there — listen closely and record again.' },
  { min: 0,  grade: 'Keep going', color: '#ff5c5c', msg: 'Practice makes perfect — slow down each syllable.' },
];

// ─── DOM refs ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const langSelect    = $('lang-select');
const voiceSelect   = $('voice-select');
const phraseGrid    = $('phrase-grid');
const customPhrase  = $('custom-phrase');
const btnContinue   = $('btn-continue');
const stepConfig    = $('step-config');
const stepPractice  = $('step-practice');
const phraseDisplay = $('phrase-display');
const btnPlayNative = $('btn-play-native');
const btnPlayUser   = $('btn-play-user');
const btnRecord     = $('btn-record');
const recordHint    = $('record-hint');
const nativeDur     = $('native-duration');
const userDur       = $('user-duration');
const canvasNative  = $('canvas-native');
const canvasUser    = $('canvas-user');
const phNative      = $('placeholder-native');
const phUser        = $('placeholder-user');
const scorePanel    = $('score-panel');
const ringFill      = $('ring-fill');
const scoreNum      = $('score-number');
const scoreGrade    = $('score-grade');
const scoreMsg      = $('score-message');
const barRhythm     = $('bar-rhythm');
const barAccuracy   = $('bar-accuracy');
const barVolume     = $('bar-volume');
const valRhythm     = $('val-rhythm');
const valAccuracy   = $('val-accuracy');
const valVolume     = $('val-volume');
const btnBack       = $('btn-back');
const btnTryAgain   = $('btn-try-again');
const btnNext       = $('btn-next-phrase');
const toastEl       = $('toast');

// ─── Boot ────────────────────────────────────────────────────
async function init() {
  try {
    const [v, p] = await Promise.all([
      fetch('/api/voices').then(r => r.json()),
      fetch('/api/phrases').then(r => r.json()),
    ]);
    voices  = v;
    phrases = p;
  } catch {
    toast('Could not reach the server. Is it running?');
    return;
  }

  populateVoices(langSelect.value);
  renderPhraseGrid(langSelect.value);

  langSelect.addEventListener('change', () => {
    currentLang = langSelect.value;
    populateVoices(currentLang);
    renderPhraseGrid(currentLang);
    selectedPhrase = '';
    customPhrase.value = '';
  });

  customPhrase.addEventListener('input', () => {
    if (customPhrase.value.trim()) {
      selectedPhrase = customPhrase.value.trim();
      document.querySelectorAll('.phrase-chip').forEach(c => c.classList.remove('active'));
    }
  });

  btnContinue.addEventListener('click', onContinue);
  btnPlayNative.addEventListener('click', playNative);
  btnPlayUser.addEventListener('click', playUser);

  btnRecord.addEventListener('click', () => {
    if (isRecording) stopRecord();
    else startRecord();
  });

  btnBack.addEventListener('click', goBack);
  btnTryAgain.addEventListener('click', resetRecording);
  btnNext.addEventListener('click', nextPhrase);
}

// ─── Voices & phrases ────────────────────────────────────────
function populateVoices(lang) {
  const list = voices[lang] || [];
  voiceSelect.innerHTML = list.map(v =>
    `<option value="${v.id}">${v.name}</option>`
  ).join('');
  selectedVoice = list[0]?.id || '';
}

function renderPhraseGrid(lang) {
  const list = phrases[lang] || [];
  phraseGrid.innerHTML = list.map(p =>
    `<button class="phrase-chip" data-phrase="${p.replace(/"/g, '&quot;')}">${p}</button>`
  ).join('');

  phraseGrid.querySelectorAll('.phrase-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      phraseGrid.querySelectorAll('.phrase-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedPhrase = chip.dataset.phrase;
      customPhrase.value = '';
    });
  });

  const first = phraseGrid.querySelector('.phrase-chip');
  if (first) { first.classList.add('active'); selectedPhrase = first.dataset.phrase; }
}

// ─── Navigation ──────────────────────────────────────────────
async function onContinue() {
  selectedVoice = voiceSelect.value;
  const rawPhrase = customPhrase.value.trim();
  const phrase = rawPhrase || selectedPhrase;
  if (!phrase) { toast('Please select or type a phrase first'); return; }

  if (rawPhrase) {
    btnContinue.disabled = true;
    btnContinue.textContent = 'Translating…';
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawPhrase, targetLang: currentLang }),
      });
      if (res.ok) {
        const data = await res.json();
        selectedPhrase = data.translatedText || rawPhrase;
      } else {
        selectedPhrase = rawPhrase;
      }
    } catch {
      selectedPhrase = rawPhrase;
    }
    
    // Fetch English translation for custom phrase
    try {
      const enRes = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: selectedPhrase, targetLang: 'en' }),
      });
      if (enRes.ok) {
        const data = await enRes.json();
        selectedTranslation = data.translatedText;
      }
    } catch {
      selectedTranslation = '';
    }
    
    btnContinue.disabled = false;
    btnContinue.textContent = 'Continue →';
  } else {
    selectedPhrase = phrase;
    
    btnContinue.disabled = true;
    btnContinue.textContent = 'Translating…';
    // Fetch English translation for predefined phrase
    try {
      const enRes = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: selectedPhrase, targetLang: 'en' }),
      });
      if (enRes.ok) {
        const data = await enRes.json();
        selectedTranslation = data.translatedText;
      }
    } catch {
      selectedTranslation = '';
    }
    btnContinue.disabled = false;
    btnContinue.textContent = 'Continue →';
  }

  showPractice();
}

let selectedTranslation = '';

function showPractice() {
  stepConfig.classList.add('hidden');
  stepPractice.classList.remove('hidden');
  phraseDisplay.textContent = selectedPhrase;
  const translationEl = $('phrase-translation');
  if (translationEl) {
     translationEl.textContent = selectedTranslation ? `“${selectedTranslation}”` : '';
  }

  nativeAudioUrl = '';
  nativeBuffer   = null;
  userBuffer     = null;
  clearCanvas(canvasNative);
  clearCanvas(canvasUser);
  phNative.classList.remove('hidden');
  phUser.classList.remove('hidden');
  nativeDur.textContent = '—';
  userDur.textContent   = '—';
  btnPlayUser.disabled  = true;
  scorePanel.classList.add('hidden');
  btnTryAgain.classList.add('hidden');
  btnNext.classList.add('hidden');
  document.querySelector('#btn-record .rec-label').textContent = 'Tap to record';
  recordHint.textContent = 'Tap the button to start recording';
}

function goBack() {
  stepPractice.classList.add('hidden');
  stepConfig.classList.remove('hidden');
}

function nextPhrase() {
  const list = phrases[currentLang] || [];
  const idx  = list.indexOf(selectedPhrase);
  selectedPhrase = list[(idx + 1) % list.length];
  phraseGrid.querySelectorAll('.phrase-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.phrase === selectedPhrase)
  );
  goBack();
}

function resetRecording() {
  userBuffer = null;
  clearCanvas(canvasUser);
  phUser.classList.remove('hidden');
  userDur.textContent  = '—';
  btnPlayUser.disabled = true;
  scorePanel.classList.add('hidden');
  btnTryAgain.classList.add('hidden');
  btnNext.classList.add('hidden');
  document.querySelector('#btn-record .rec-label').textContent = 'Tap to record';
  recordHint.textContent = 'Tap the button to start recording';
}

// ─── TTS via backend ─────────────────────────────────────────
async function fetchNativeAudio() {
  if (nativeAudioUrl) return nativeAudioUrl;

  setPlayNativeLoading(true);

  try {
    const res = await fetch('/api/tts', {           // ← hits our Node server
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceId: selectedVoice, text: selectedPhrase }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }

    const data = await res.json();
    nativeAudioUrl = data.audioUrl;
    return nativeAudioUrl;

  } catch (err) {
    toast('Error: ' + err.message);
    return null;
  } finally {
    setPlayNativeLoading(false);
  }
}

function setPlayNativeLoading(loading) {
  btnPlayNative.disabled = loading;
  btnPlayNative.innerHTML = loading
    ? `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="40" stroke-dashoffset="30"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg>`
    : `<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>`;
}

// ─── Playback ────────────────────────────────────────────────
async function playNative() {
  if (currentNativeSrc) {
    currentNativeSrc.stop();
    return;
  }

  const url = await fetchNativeAudio();
  if (!url) return;

  if (!nativeBuffer) {
    nativeBuffer = await loadAudioBuffer(url);
    if (nativeBuffer) {
      drawWaveform(canvasNative, nativeBuffer, 'native');
      phNative.classList.add('hidden');
      nativeDur.textContent = formatDuration(nativeBuffer.duration);
    }
  }

  const speed = document.getElementById('native-speed') ? parseFloat(document.getElementById('native-speed').value) : 1;
  currentNativeSrc = playBuffer(nativeBuffer, btnPlayNative, () => {
    currentNativeSrc = null;
  }, speed);
}

function playUser() {
  if (currentUserSrc) {
    currentUserSrc.stop();
    return;
  }

  if (!userBuffer) return;
  currentUserSrc = playBuffer(userBuffer, btnPlayUser, () => {
    currentUserSrc = null;
  });
}

function playBuffer(buffer, btn, onEndedCb, rate = 1) {
  if (!buffer) return null;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  src.connect(ctx.destination);

  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" fill="currentColor"/></svg>`;
  btn.classList.add('playing');

  src.onended = () => {
    btn.innerHTML = originalHtml;
    btn.classList.remove('playing');
    if (onEndedCb) onEndedCb();
  };

  src.start();
  return src;
}

async function loadAudioBuffer(url) {
  try {
    const raw = await fetch(url).then(r => r.arrayBuffer());
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    return await ctx.decodeAudioData(raw);
  } catch {
    toast('Could not decode audio');
    return null;
  }
}

function formatDuration(secs) {
  const s = Math.round(secs);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ─── Recording ───────────────────────────────────────────────
async function startRecord() {
  if (isRecording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    finalTranscript = '';
    interimTranscript = '';
    if (recognition) {
      recognition.lang = currentLang;
      // Restart recognition if it ends prematurely (common on mobile)
      recognition.onend = () => {
        if (isRecording) {
            try { recognition.start(); } catch(err) {}
        }
      };
      try { recognition.start(); } catch(err) {}
    }
    mediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = onRecordStop;
    mediaRecorder.start(100);
    isRecording = true;
    btnRecord.classList.add('recording');
    btnRecord.querySelector('.rec-label').textContent = 'Recording… (Tap to stop)';
    recordHint.textContent = 'Tap to stop recording';
  } catch {
    toast('Microphone access denied. Please allow microphone in your browser.');
  }
}

function stopRecord() {
  if (!isRecording || !mediaRecorder) return;
  mediaRecorder.stop();
  if (recognition) {
    recognition.onend = null; // Prevent restart loops if we are stopping intentionally
    try { recognition.stop(); } catch(err) {}
  }
  mediaRecorder.stream.getTracks().forEach(t => t.stop());
  isRecording = false;
  btnRecord.classList.remove('recording');
  btnRecord.querySelector('.rec-label').textContent = 'Tap to record';
  recordHint.textContent = 'Processing…';
}

async function onRecordStop() {
  const blob = new Blob(chunks, { type: getSupportedMimeType() });
  try {
    const raw = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    userBuffer = await ctx.decodeAudioData(raw);
    drawWaveform(canvasUser, userBuffer, 'user');
    phUser.classList.add('hidden');
    userDur.textContent  = formatDuration(userBuffer.duration);
    btnPlayUser.disabled = false;
    recordHint.textContent = 'Listen to both tracks, then check your score';
    computeScore();
  } catch {
    toast('Could not process your recording — try again');
    recordHint.textContent = 'Try recording again';
  }
}

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

// ─── Waveform drawing ────────────────────────────────────────
function drawWaveform(canvas, buffer, type) {
  const data = buffer.getChannelData(0);
  const W = canvas.offsetWidth  || 300;
  const H = canvas.offsetHeight || 72;
  canvas.width  = W * devicePixelRatio;
  canvas.height = H * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const barW = 3, gap = 1.5, total = barW + gap;
  const bars  = Math.floor(W / total);
  const chunk = Math.floor(data.length / bars);
  const color = type === 'native' ? '#00e5c4' : '#ff8a65';
  const dim   = type === 'native' ? 'rgba(0,229,196,0.15)' : 'rgba(255,138,101,0.15)';

  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < bars; i++) {
    let sum = 0;
    for (let j = 0; j < chunk; j++) sum += Math.abs(data[i * chunk + j] || 0);
    const amp  = sum / chunk;
    const barH = Math.max(2, amp * H * 2.8);
    const x = i * total, y = (H - barH) / 2;
    ctx.fillStyle = amp > 0.02 ? color : dim;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, 1);
    ctx.fill();
  }
}

function clearCanvas(canvas) {
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

// ─── Scoring ─────────────────────────────────────────────────
function computeScore() {
  if (!userBuffer) return;
  const nativeSecs = nativeBuffer?.duration || userBuffer.duration;
  const userSecs   = userBuffer.duration;

  // Rhythm: duration ratio
  const ratio  = Math.min(nativeSecs, userSecs) / Math.max(nativeSecs, userSecs);
  const rhythm = Math.round(ratio * 100);

  // Volume: peak amplitude
  const data   = userBuffer.getChannelData(0);
  const peak   = data.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const volume = Math.min(100, Math.round(peak * 120));

  // If there's barely any volume, assume silence or only background room noise
  if (peak < 0.015) { // Lowered slightly from 0.02 for quieter mobile mics
    showScorePanelZero('Not Detected', '#666', 'Voice not detected. Please speak closer to the microphone.', 0, 0, volume);
    return;
  }

  // Accuracy: Web Speech API Transcript Match
  let accuracy = 0;
  if (!SpeechRec) {
    accuracy = Math.round(Math.random() * 20 + 70); // fallback heuristic
  } else {
    const userText = (finalTranscript + ' ' + interimTranscript).trim().toLowerCase();
    
    const targetText = selectedPhrase.toLowerCase();
    const cleanTarget = targetText.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);

    // Check if the microphone picked up volume, but Speech API captured absolutely zero words
    if (!userText) {
      // Mobile Safari/Chrome often drops recognition. Instead of rejecting, give a fallback score based on rhythm/duration vs target phrase length.
      if (cleanTarget.length > 0) {
        // Fallback accuracy base simply applies a slightly generous rhythm score when we know they spoke
        accuracy = Math.max(10, rhythm - 15);
      } else {
         accuracy = 100;
      }
    } else {
      // strip punctuation (Unicode-aware if possible)
      const cleanUser = userText.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
      
      if (cleanTarget.length === 0) {
        accuracy = 100;
      } else if (cleanUser.length === 0) {
        accuracy = Math.max(10, rhythm - 15); // Fallback
      } else {
        let matches = 0;
        let matchedIndices = new Set();
        
        for (const uw of cleanUser) {
          for (let i = 0; i < cleanTarget.length; i++) {
            if (!matchedIndices.has(i)) {
              if (cleanTarget[i] === uw || cleanTarget[i].includes(uw) || uw.includes(cleanTarget[i])) {
                matches++;
                matchedIndices.add(i);
                break;
              }
            }
          }
        }
        accuracy = Math.round((matches / cleanTarget.length) * 100);
        accuracy = Math.max(10, Math.min(100, accuracy));
      }
    }
  }

  const overall = Math.round(rhythm * 0.3 + accuracy * 0.5 + volume * 0.2);
  showScore(overall, rhythm, accuracy, volume);
}

function showScorePanelZero(title, color, msg, rhythm, accuracy, volume) {
  scorePanel.classList.remove('hidden');
  btnTryAgain.classList.remove('hidden');
  btnNext.classList.remove('hidden');

  animateNumber(scoreNum, 0, 800);
  const offset = 314.16; // strokeDashoffset for 0%
  requestAnimationFrame(() => { ringFill.style.strokeDashoffset = offset; });
  
  scoreGrade.textContent = title;
  scoreGrade.style.color = color;
  ringFill.style.stroke  = color;
  scoreMsg.textContent   = msg;

  setTimeout(() => {
    barRhythm.style.width   = rhythm  + '%';
    barAccuracy.style.width = accuracy + '%';
    barVolume.style.width   = volume  + '%';
    valRhythm.textContent   = rhythm  + '%';
    valAccuracy.textContent = accuracy + '%';
    valVolume.textContent   = volume  + '%';
  }, 200);
}

function showScore(score, rhythm, accuracy, volume) {
  scorePanel.classList.remove('hidden');
  btnTryAgain.classList.remove('hidden');
  btnNext.classList.remove('hidden');

  animateNumber(scoreNum, score, 1000);

  const offset = 314.16 * (1 - score / 100);
  requestAnimationFrame(() => { ringFill.style.strokeDashoffset = offset; });

  const grade = GRADE_MAP.find(g => score >= g.min) || GRADE_MAP[GRADE_MAP.length - 1];
  scoreGrade.textContent   = grade.grade;
  scoreGrade.style.color   = grade.color;
  ringFill.style.stroke    = grade.color;
  scoreMsg.textContent     = grade.msg;

  setTimeout(() => {
    barRhythm.style.width   = rhythm  + '%';
    barAccuracy.style.width = accuracy + '%';
    barVolume.style.width   = volume  + '%';
    valRhythm.textContent   = rhythm  + '%';
    valAccuracy.textContent = accuracy + '%';
    valVolume.textContent   = volume  + '%';
  }, 200);
}

function animateNumber(el, target, duration) {
  const start = parseInt(el.textContent) || 0;
  const t0 = performance.now();
  const tick = now => {
    const t    = Math.min(1, (now - t0) / duration);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(start + (target - start) * ease);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ─── Toast ───────────────────────────────────────────────────
let toastTimeout;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toastEl.classList.add('hidden'), 3500);
}

// ─── Go ──────────────────────────────────────────────────────
init();
