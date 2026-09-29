/* ═══════════════════════════════════════════════════════════
   MimicAI — Frontend Application Logic
   Includes: Speech Evaluation, Authentication (Email/Google),
   User Dashboard, Audio Waveforms, and Neon Cloud History.
   ═══════════════════════════════════════════════════════════ */

// ─── Application State ───────────────────────────────────────
let voices         = {};
let phrases        = {};
let selectedPhrase = '';
let selectedVoice  = '';
let selectedTranslation = '';
let currentLang    = 'ta-IN';

let nativeAudioUrl = '';
let nativeBuffer   = null;
let userBuffer     = null;
let mediaRecorder  = null;
let chunks         = [];
let isRecording    = false;
let currentNativeSrc = null;
let currentUserSrc   = null;

// Speech Recognition for live input
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

let isInputVoiceActive = false;
let inputMediaRecorder = null;
let inputChunks = [];

// Auth State
let currentUser = null;
let authToken = localStorage.getItem('mimicai_token') || null;
let googleClientId = '';
let hasDatabase = false;

// Dashboard State
let historyCache = [];
let currentPlayingAudio = null;
let currentPlayingBtn = null;

// ─── Score Grade Map ─────────────────────────────────────────
const GRADE_MAP = [
  { min: 90, grade: 'Excellent',  color: '#00E5FF', msg: 'Near-native pronunciation! Flawless cadence.' },
  { min: 75, grade: 'Great',      color: '#4DD0E1', msg: "Strong effort — very close to native delivery." },
  { min: 60, grade: 'Good',       color: '#B388FF', msg: 'Good clarity! Focus slightly more on rhythm.' },
  { min: 40, grade: 'Fair',       color: '#FF8A80', msg: 'Getting there — listen closely and try once more.' },
  { min: 0,  grade: 'Keep Going', color: '#FF4D85', msg: 'Practice makes perfect — articulate each syllable.' },
];

// ─── DOM Helper ──────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── Initialization ──────────────────────────────────────────
async function init() {
  setupNavigation();
  setupAuthModal();
  setupDashboardControls();

  // Load server configuration (Google Client ID & DB status)
  await loadServerConfig();

  // Check and restore active user session
  await restoreUserSession();

  // Load voices & phrase catalog
  try {
    const [v, p] = await Promise.all([
      fetch('/api/voices').then(r => r.json()),
      fetch('/api/phrases').then(r => r.json()),
    ]);
    voices  = v;
    phrases = p;
  } catch (err) {
    console.error('Initialization error:', err);
    toast('Could not reach server. Please check your connection.');
    return;
  }

  currentLang = $('lang-select').value;
  populateVoices(currentLang);
  renderPhraseGrid(currentLang);

  // Event Listeners for Trainer Setup
  $('lang-select').addEventListener('change', () => {
    currentLang = $('lang-select').value;
    populateVoices(currentLang);
    renderPhraseGrid(currentLang);
    selectedPhrase = '';
    $('custom-phrase').value = '';
    if ($('current-lang-tag')) {
      $('current-lang-tag').textContent = $('lang-select').options[$('lang-select').selectedIndex].text;
    }
  });

  $('custom-phrase').addEventListener('input', () => {
    if ($('custom-phrase').value.trim()) {
      selectedPhrase = $('custom-phrase').value.trim();
      document.querySelectorAll('.phrase-chip').forEach(c => c.classList.remove('selected'));
    }
  });

  $('btn-continue').addEventListener('click', onContinue);
  $('btn-play-native').addEventListener('click', playNative);
  $('btn-play-user').addEventListener('click', playUser);

  $('btn-record').addEventListener('click', () => {
    if (isRecording) stopRecord();
    else startRecord();
  });

  $('btn-back').addEventListener('click', goBack);
  $('btn-try-again').addEventListener('click', resetRecording);
  $('btn-next-phrase').addEventListener('click', nextPhrase);

  if ($('btn-input-mic')) {
    $('btn-input-mic').addEventListener('click', toggleInputVoice);
  }
}

// ─── Navigation & Views ──────────────────────────────────────
function setupNavigation() {
  const tabTrainer = $('tab-trainer');
  const tabDashboard = $('tab-dashboard');
  const viewTrainer = $('view-trainer');
  const viewDashboard = $('view-dashboard');

  tabTrainer.addEventListener('click', () => {
    tabTrainer.classList.add('active');
    tabDashboard.classList.remove('active');
    viewTrainer.classList.remove('hidden');
    viewDashboard.classList.add('hidden');
    stopAnyPlayingAudio();
  });

  tabDashboard.addEventListener('click', () => {
    tabDashboard.classList.add('active');
    tabTrainer.classList.remove('active');
    viewDashboard.classList.remove('hidden');
    viewTrainer.classList.add('hidden');
    renderDashboard();
    stopAnyPlayingAudio();
  });

  $('logo-home').addEventListener('click', () => {
    tabTrainer.click();
  });

  $('btn-nav-to-dash')?.addEventListener('click', () => {
    $('user-dropdown').classList.add('hidden');
    tabDashboard.click();
  });

  // User profile dropdown toggle
  $('user-pill')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('user-dropdown').classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    $('user-dropdown')?.classList.add('hidden');
  });
}

// ─── Configuration & Session ─────────────────────────────────
async function loadServerConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    googleClientId = data.googleClientId;
    hasDatabase = data.hasDatabase;

    const dbBadge = $('db-badge');
    const dbStatusText = $('db-status-text');

    if (hasDatabase) {
      dbBadge?.classList.remove('offline');
      if (dbStatusText) dbStatusText.textContent = 'Neon Cloud';
    } else {
      dbBadge?.classList.add('offline');
      if (dbStatusText) dbStatusText.textContent = 'Setup DB';
      dbBadge?.setAttribute('title', 'DATABASE_URL is not set in .env. Sessions will not persist.');
    }

    // Initialize Google Identity Services if client ID available
    initGoogleAuth();
  } catch (err) {
    console.warn('Could not load config:', err);
  }
}

async function restoreUserSession() {
  if (!authToken) {
    renderUserUI(null);
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      renderUserUI(currentUser);
    } else {
      // Invalid/expired token
      localStorage.removeItem('mimicai_token');
      authToken = null;
      currentUser = null;
      renderUserUI(null);
    }
  } catch (err) {
    console.error('Session restore error:', err);
    renderUserUI(null);
  }
}

function renderUserUI(user) {
  const guestSec = $('auth-guest-section');
  const userSec = $('auth-user-section');
  const guestCard = $('dash-guest-card');
  const authContent = $('dash-auth-content');

  if (user) {
    guestSec?.classList.add('hidden');
    userSec?.classList.remove('hidden');

    const displayName = user.name || user.email.split('@')[0];
    const initial = displayName.charAt(0).toUpperCase();

    if ($('user-name')) $('user-name').textContent = displayName;
    if ($('dropdown-user-name')) $('dropdown-user-name').textContent = displayName;
    if ($('dropdown-user-email')) $('dropdown-user-email').textContent = user.email;
    if ($('dash-greeting')) $('dash-greeting').textContent = `Welcome back, ${displayName}!`;

    const avatarEl = $('user-avatar');
    if (avatarEl) {
      if (user.avatar_url) {
        avatarEl.innerHTML = `<img src="${user.avatar_url}" alt="${displayName}"/>`;
      } else {
        avatarEl.textContent = initial;
      }
    }

    guestCard?.classList.add('hidden');
    authContent?.classList.remove('hidden');
  } else {
    guestSec?.classList.remove('hidden');
    userSec?.classList.add('hidden');
    guestCard?.classList.remove('hidden');
    authContent?.classList.add('hidden');
  }
}

// ─── Authentication Logic ────────────────────────────────────
function setupAuthModal() {
  const modal = $('auth-modal');
  const btnOpen = $('btn-open-login');
  const btnClose = $('btn-close-auth');
  const btnGuestUnlock = $('btn-guest-unlock');
  const tabLogin = $('tab-login');
  const tabRegister = $('tab-register');
  const groupName = $('group-name');
  const modalTitle = $('auth-modal-title');
  const btnSubmitText = $('btn-auth-text');
  const authForm = $('auth-form');
  const alertEl = $('modal-error-alert');
  const btnLogout = $('btn-logout');

  let authMode = 'login'; // 'login' or 'register'

  const openModal = (mode = 'login') => {
    authMode = mode;
    updateModalView();
    alertEl.classList.add('hidden');
    modal.classList.remove('hidden');
  };

  const closeModal = () => {
    modal.classList.add('hidden');
    authForm.reset();
    alertEl.classList.add('hidden');
  };

  const updateModalView = () => {
    if (authMode === 'login') {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      groupName.classList.add('hidden');
      modalTitle.textContent = 'Sign in to MimicAI';
      btnSubmitText.textContent = 'Sign In';
    } else {
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      groupName.classList.remove('hidden');
      modalTitle.textContent = 'Create your Account';
      btnSubmitText.textContent = 'Create Account';
    }
  };

  btnOpen?.addEventListener('click', () => openModal('login'));
  btnGuestUnlock?.addEventListener('click', () => openModal('login'));
  btnClose?.addEventListener('click', closeModal);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  tabLogin?.addEventListener('click', () => { authMode = 'login'; updateModalView(); });
  tabRegister?.addEventListener('click', () => { authMode = 'register'; updateModalView(); });

  // Custom Google Button click handler
  $('btn-custom-google')?.addEventListener('click', () => {
    if (googleTokenClient) {
      googleTokenClient.requestAccessToken({ prompt: 'consent' });
    } else if (window.google?.accounts?.id && googleClientId) {
      google.accounts.id.prompt();
    } else {
      toast('Google Sign-In is initializing. Please try again in a moment.');
    }
  });

  // Email / Password Form Submit
  authForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertEl.classList.add('hidden');

    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    const name = $('auth-name').value.trim();

    if (!email || !password) {
      showAlert('Email and password are required');
      return;
    }

    if (password.length < 6) {
      showAlert('Password must be at least 6 characters');
      return;
    }

    setAuthLoading(true);

    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = authMode === 'login' ? { email, password } : { email, password, name };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      // Successful login/register
      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('mimicai_token', authToken);

      renderUserUI(currentUser);
      closeModal();
      toast(`Welcome, ${currentUser.name || 'Speaker'}! 🎉`);

      // If on dashboard view, load history
      if ($('tab-dashboard').classList.contains('active')) {
        renderDashboard();
      }

    } catch (err) {
      showAlert(err.message);
    } finally {
      setAuthLoading(false);
    }
  });

  // Logout
  btnLogout?.addEventListener('click', () => {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('mimicai_token');
    renderUserUI(null);
    $('user-dropdown').classList.add('hidden');
    toast('Signed out successfully');
  });

  function showAlert(msg) {
    alertEl.textContent = msg;
    alertEl.classList.remove('hidden');
  }

  function setAuthLoading(loading) {
    $('btn-auth-submit').disabled = loading;
    $('auth-spinner').classList.toggle('hidden', !loading);
  }
}

// ─── Google OAuth Integration ────────────────────────────────
let googleTokenClient = null;

window.onGoogleLibraryLoad = () => {
  initGoogleAuth();
};

function initGoogleAuth() {
  if (!window.google || !googleClientId) return;

  try {
    // 1. Initialize ID Token flow
    google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleGoogleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
      error_callback: (err) => {
        console.warn('Google GSI error:', err);
        if (err && err.type === 'origin_mismatch') {
          toast('Google OAuth origin mismatch: Add http://localhost:3000 to Authorized Origins in Google Console.');
        }
      }
    });

    const googleBtnWrap = $('google-btn-wrapper');
    if (googleBtnWrap) {
      google.accounts.id.renderButton(googleBtnWrap, {
        theme: 'filled_blue',
        size: 'large',
        width: 320,
        text: 'continue_with',
        shape: 'pill'
      });
      $('btn-custom-google')?.classList.add('hidden');
    }

    // 2. Initialize OAuth 2.0 Popup Token Client (works even if One-Tap or third-party cookies are blocked)
    if (window.google.accounts && window.google.accounts.oauth2) {
      googleTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: 'email profile openid',
        callback: handleGoogleAccessTokenResponse,
        error_callback: (err) => {
          console.error('Google OAuth token error:', err);
          toast('Google OAuth error: ' + (err.message || 'Please check Authorized Origins in Google Console'));
        }
      });
    }
  } catch (err) {
    console.warn('Google Identity initialization error:', err);
    $('btn-custom-google')?.classList.remove('hidden');
  }
}

async function handleGoogleCredentialResponse(response) {
  if (!response.credential) return;

  const overlay = $('oauth-loading-overlay');
  overlay?.classList.remove('hidden');

  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Google login failed');

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('mimicai_token', authToken);

    renderUserUI(currentUser);
    $('auth-modal').classList.add('hidden');
    toast(`Welcome, ${currentUser.name}! 🎉`);

    if ($('tab-dashboard').classList.contains('active')) {
      renderDashboard();
    }
  } catch (err) {
    console.error('Google Sign-In failed:', err);
    toast('Google Sign-In failed: ' + err.message);
  } finally {
    overlay?.classList.add('hidden');
  }
}

async function handleGoogleAccessTokenResponse(tokenResponse) {
  const overlay = $('oauth-loading-overlay');

  if (tokenResponse.error) {
    overlay?.classList.add('hidden');
    console.error('Google token error:', tokenResponse);
    toast('Google Sign-In error: ' + (tokenResponse.error_description || tokenResponse.error));
    return;
  }

  if (!tokenResponse.access_token) {
    overlay?.classList.add('hidden');
    return;
  }

  overlay?.classList.remove('hidden');

  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: tokenResponse.access_token }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Google login failed');

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('mimicai_token', authToken);

    renderUserUI(currentUser);
    $('auth-modal').classList.add('hidden');
    toast(`Welcome, ${currentUser.name}! 🎉`);

    if ($('tab-dashboard').classList.contains('active')) {
      renderDashboard();
    }
  } catch (err) {
    console.error('Google Sign-In failed:', err);
    toast('Google Sign-In failed: ' + err.message);
  } finally {
    overlay?.classList.add('hidden');
  }
}

// ─── User Dashboard & History ────────────────────────────────
function setupDashboardControls() {
  $('btn-refresh-history')?.addEventListener('click', () => {
    fetchUserHistory(true);
  });

  $('history-search')?.addEventListener('input', () => {
    filterAndRenderHistory();
  });

  $('history-lang-filter')?.addEventListener('change', () => {
    fetchUserHistory(false);
  });

  // Edit display name in dashboard
  const btnEditName = $('btn-edit-name');
  const formEditName = $('name-edit-form');
  const inputEditName = $('input-edit-name');
  const btnCancelName = $('btn-cancel-name');
  const greetingRow = document.querySelector('.greeting-row');

  btnEditName?.addEventListener('click', () => {
    if (!currentUser) return;
    inputEditName.value = currentUser.name || '';
    greetingRow?.classList.add('hidden');
    formEditName?.classList.remove('hidden');
    inputEditName.focus();
  });

  btnCancelName?.addEventListener('click', () => {
    formEditName?.classList.add('hidden');
    greetingRow?.classList.remove('hidden');
  });

  formEditName?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newName = inputEditName.value.trim();
    if (!newName) {
      toast('Please enter a valid display name');
      return;
    }

    if (newName === currentUser.name) {
      formEditName?.classList.add('hidden');
      greetingRow?.classList.remove('hidden');
      return;
    }

    const btnSave = $('btn-save-name');
    const originalSaveHtml = btnSave.innerHTML;
    btnSave.innerHTML = `<span class="loading-spinner-small"></span>`;
    btnSave.disabled = true;

    try {
      const res = await fetch('/api/user/name', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ name: newName })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update name');

      currentUser = data.user;
      if (data.token) {
        authToken = data.token;
        localStorage.setItem('mimicai_token', authToken);
      }

      renderUserUI(currentUser);
      formEditName?.classList.add('hidden');
      greetingRow?.classList.remove('hidden');
      toast('Display name updated successfully! 🎉');
    } catch (err) {
      console.error('Update name error:', err);
      toast('Error: ' + err.message);
    } finally {
      btnSave.innerHTML = originalSaveHtml;
      btnSave.disabled = false;
    }
  });
}

async function renderDashboard() {
  if (!currentUser) return;
  await fetchUserHistory(false);
}

async function fetchUserHistory(showToast = false) {
  if (!authToken) return;

  const historyList = $('history-list');
  historyList.innerHTML = `
    <div class="history-loading">
      <span class="loading-spinner"></span>
      <p style="margin-top: 10px;">Loading your recordings from Neon Cloud…</p>
    </div>
  `;

  const langFilter = $('history-lang-filter')?.value || 'all';

  try {
    const url = `/api/history?lang=${encodeURIComponent(langFilter)}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Could not fetch history');
    }

    const data = await res.json();
    historyCache = data.history || [];

    // Update stats
    if ($('stat-total')) $('stat-total').textContent = data.stats.totalPractices;
    if ($('stat-avg')) $('stat-avg').textContent = data.stats.avgScore;
    if ($('stat-best')) $('stat-best').textContent = data.stats.bestScore;
    if ($('stat-languages')) $('stat-languages').textContent = data.stats.languagesCount;

    filterAndRenderHistory();

    if (showToast) toast('History updated from Neon Cloud ⚡');

  } catch (err) {
    console.error('Error fetching history:', err);
    historyList.innerHTML = `
      <div class="history-empty">
        <p>⚠️ ${err.message}</p>
        <button class="btn-secondary btn-sm" style="margin-top: 12px;" onclick="renderDashboard()">Try Again</button>
      </div>
    `;
  }
}

function filterAndRenderHistory() {
  const searchTerm = ($('history-search')?.value || '').trim().toLowerCase();
  const historyList = $('history-list');

  let list = historyCache;
  if (searchTerm) {
    list = list.filter(item =>
      (item.phrase && item.phrase.toLowerCase().includes(searchTerm)) ||
      (item.translation && item.translation.toLowerCase().includes(searchTerm))
    );
  }

  if (list.length === 0) {
    historyList.innerHTML = `
      <div class="history-empty">
        <p style="font-size: 1.1rem; color: #fff; margin-bottom: 6px;">No practice records found</p>
        <p style="font-size: 0.88rem; color: var(--text-dim);">Jump over to the Trainer and test your pronunciation!</p>
        <button class="btn-primary btn-sm" style="margin-top: 16px;" onclick="$('tab-trainer').click()">Go to Trainer →</button>
      </div>
    `;
    return;
  }

  historyList.innerHTML = list.map(item => renderHistoryCardHtml(item)).join('');

  // Attach card action listeners
  historyList.querySelectorAll('.btn-card-action.play').forEach(btn => {
    btn.addEventListener('click', () => {
      const sessionId = btn.dataset.id;
      playStoredAudio(sessionId, btn);
    });
  });

  historyList.querySelectorAll('.btn-card-action.practice').forEach(btn => {
    btn.addEventListener('click', () => {
      const phrase = btn.dataset.phrase;
      const lang = btn.dataset.lang;
      loadPhraseIntoTrainer(phrase, lang);
    });
  });

  historyList.querySelectorAll('.btn-card-action.delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const sessionId = btn.dataset.id;
      deleteHistoryItem(sessionId);
    });
  });
}

function renderHistoryCardHtml(item) {
  const score = item.overall_score || 0;
  const grade = GRADE_MAP.find(g => score >= g.min) || GRADE_MAP[GRADE_MAP.length - 1];
  const dateFormatted = formatRelativeDate(item.created_at);

  return `
    <div class="history-card" id="history-card-${item.id}">
      <div class="card-left">
        <div class="card-tags">
          <span class="card-lang-tag">${getLanguageDisplayName(item.language)}</span>
          <span class="card-date">${dateFormatted}</span>
        </div>
        <h4 class="card-phrase">${escapeHtml(item.phrase)}</h4>
        ${item.translation ? `<p class="card-translation">“${escapeHtml(item.translation)}”</p>` : ''}
      </div>

      <div class="card-metrics">
        <div class="card-score-pill" style="border-color: ${grade.color};">
          <span class="pill-num">${score}%</span>
          <span class="pill-label">${grade.grade}</span>
        </div>

        <div class="card-breakdown-mini">
          <div>Acc: <strong>${item.accuracy}%</strong></div>
          <div>Rhy: <strong>${item.rhythm}%</strong></div>
          <div>Vol: <strong>${item.volume}%</strong></div>
        </div>
      </div>

      <div class="card-actions">
        ${item.has_recording ? `
          <button class="btn-card-action play" data-id="${item.id}" title="Replay your recorded attempt">
            <svg viewBox="0 0 24 24" width="16" height="16"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>
          </button>
        ` : ''}
        <button class="btn-card-action practice" data-phrase="${escapeHtml(item.phrase)}" data-lang="${item.language}" title="Practice this phrase again">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        </button>
        <button class="btn-card-action delete" data-id="${item.id}" title="Delete session">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    </div>
  `;
}

function playStoredAudio(sessionId, btn) {
  const audio = $('global-audio-player');

  if (currentPlayingAudio && currentPlayingBtn === btn) {
    audio.pause();
    stopAnyPlayingAudio();
    return;
  }

  stopAnyPlayingAudio();

  audio.src = `/api/recordings/${sessionId}`;
  currentPlayingAudio = audio;
  currentPlayingBtn = btn;

  btn.classList.add('active');
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><rect x="6" y="4" width="4" height="16" fill="currentColor"></rect><rect x="14" y="4" width="4" height="16" fill="currentColor"></rect></svg>`;

  audio.play().catch(err => {
    console.error('Audio playback failed:', err);
    toast('Could not play recording: ' + err.message);
    stopAnyPlayingAudio();
  });

  audio.onended = () => {
    stopAnyPlayingAudio();
  };
}

function stopAnyPlayingAudio() {
  const audio = $('global-audio-player');
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
  if (currentPlayingBtn) {
    currentPlayingBtn.classList.remove('active');
    currentPlayingBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>`;
  }
  currentPlayingAudio = null;
  currentPlayingBtn = null;
}

async function deleteHistoryItem(sessionId) {
  if (!confirm('Are you sure you want to delete this recorded session?')) return;

  try {
    const res = await fetch(`/api/history/${sessionId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!res.ok) throw new Error('Failed to delete recording');

    // Remove from local cache & DOM
    historyCache = historyCache.filter(item => item.id != sessionId);
    const cardEl = $(`history-card-${sessionId}`);
    if (cardEl) {
      cardEl.style.opacity = '0';
      cardEl.style.transform = 'translateY(-10px)';
      setTimeout(() => cardEl.remove(), 250);
    }
    toast('Recording removed from history');
  } catch (err) {
    toast('Error: ' + err.message);
  }
}

function loadPhraseIntoTrainer(phrase, lang) {
  $('tab-trainer').click();
  const langSelect = $('lang-select');
  if (lang && langSelect) {
    langSelect.value = lang;
    currentLang = lang;
    populateVoices(lang);
    renderPhraseGrid(lang);
    if ($('current-lang-tag')) {
      $('current-lang-tag').textContent = langSelect.options[langSelect.selectedIndex].text;
    }
  }

  $('custom-phrase').value = phrase;
  selectedPhrase = phrase;
  document.querySelectorAll('.phrase-chip').forEach(c => c.classList.remove('selected'));

  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast(`Loaded phrase: "${phrase}"`);
}

// ─── Voices & Phrases Setup ──────────────────────────────────
function populateVoices(lang) {
  const list = voices[lang] || [];
  const voiceSelect = $('voice-select');
  voiceSelect.innerHTML = list.map(v =>
    `<option value="${v.id}">${v.name}</option>`
  ).join('');
  selectedVoice = list[0]?.id || '';
}

function renderPhraseGrid(lang) {
  const list = phrases[lang] || [];
  const phraseGrid = $('phrase-grid');
  phraseGrid.innerHTML = list.map(p =>
    `<button type="button" class="phrase-chip" data-phrase="${escapeHtml(p)}">${p}</button>`
  ).join('');

  phraseGrid.querySelectorAll('.phrase-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      phraseGrid.querySelectorAll('.phrase-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedPhrase = chip.dataset.phrase;
      $('custom-phrase').value = '';
    });
  });

  const first = phraseGrid.querySelector('.phrase-chip');
  if (first) {
    first.classList.add('selected');
    selectedPhrase = first.dataset.phrase;
  }
}

// ─── Trainer Navigation Flow ─────────────────────────────────
async function onContinue() {
  selectedVoice = $('voice-select').value;
  const rawPhrase = $('custom-phrase').value.trim();
  const phrase = rawPhrase || selectedPhrase;
  if (!phrase) { toast('Please select or type a phrase first'); return; }

  const btnContinue = $('btn-continue');
  btnContinue.disabled = true;
  btnContinue.innerHTML = `<span class="loading-spinner-small"></span> <span>Preparing…</span>`;

  try {
    if (rawPhrase) {
      const [targetRes, enRes] = await Promise.all([
        fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: rawPhrase, targetLang: currentLang }),
        }),
        fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: rawPhrase, targetLang: 'en' }),
        })
      ]);

      const [targetData, enData] = await Promise.all([
        targetRes.json().catch(() => ({})),
        enRes.json().catch(() => ({}))
      ]);

      if (targetData.translatedText) {
        selectedPhrase = targetData.translatedText;
      }
      selectedTranslation = enData.translatedText || rawPhrase;
    } else {
      // Sample phrase: translate to English for contextual learning
      const enRes = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: selectedPhrase, targetLang: 'en' }),
      });
      const enData = await enRes.json().catch(() => ({}));
      selectedTranslation = enData.translatedText || '';
    }
  } catch (err) {
    console.error('Translation error:', err);
    selectedTranslation = '';
  } finally {
    btnContinue.disabled = false;
    btnContinue.innerHTML = `<span>Start Practice</span> <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
  }

  showPractice();
}

function showPractice() {
  $('step-config').classList.add('hidden');
  $('step-practice').classList.remove('hidden');
  $('phrase-display').textContent = selectedPhrase;

  const translationEl = $('phrase-translation');
  if (translationEl) {
    translationEl.textContent = selectedTranslation ? `“${selectedTranslation}”` : '';
  }

  if ($('current-lang-tag')) {
    $('current-lang-tag').textContent = $('lang-select').options[$('lang-select').selectedIndex].text;
  }

  nativeAudioUrl = '';
  nativeBuffer   = null;
  userBuffer     = null;
  clearCanvas($('canvas-native'));
  clearCanvas($('canvas-user'));
  $('placeholder-native').classList.remove('hidden');
  $('placeholder-user').classList.remove('hidden');
  $('native-duration').textContent = '0:00';
  $('user-duration').textContent   = '—';
  $('btn-play-user').disabled      = true;
  $('score-panel').classList.add('hidden');
  $('btn-try-again').classList.add('hidden');
  $('btn-next-phrase').classList.add('hidden');
  $('save-status-badge')?.classList.add('hidden');

  $('btn-record').classList.remove('recording');
  $('btn-record').querySelector('.rec-label').textContent = 'Tap to Record';
  $('record-hint').textContent = 'Tap the microphone button to start recording';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goBack() {
  $('step-practice').classList.add('hidden');
  $('step-config').classList.remove('hidden');
  stopNativeAudio();
}

function nextPhrase() {
  const list = phrases[currentLang] || [];
  const idx  = list.indexOf(selectedPhrase);
  selectedPhrase = list[(idx + 1) % list.length];
  $('phrase-grid').querySelectorAll('.phrase-chip').forEach(c =>
    c.classList.toggle('selected', c.dataset.phrase === selectedPhrase)
  );
  goBack();
}

function resetRecording() {
  userBuffer = null;
  clearCanvas($('canvas-user'));
  $('placeholder-user').classList.remove('hidden');
  $('user-duration').textContent  = '—';
  $('btn-play-user').disabled     = true;
  $('score-panel').classList.add('hidden');
  $('btn-try-again').classList.add('hidden');
  $('btn-next-phrase').classList.add('hidden');
  $('save-status-badge')?.classList.add('hidden');

  $('btn-record').classList.remove('recording');
  $('btn-record').querySelector('.rec-label').textContent = 'Tap to Record';
  $('record-hint').textContent = 'Tap the button to record again';
}

// ─── TTS Native Speaker Audio ────────────────────────────────
async function fetchNativeAudio() {
  if (nativeAudioUrl) return nativeAudioUrl;
  setPlayNativeLoading(true);

  try {
    const res = await fetch('/api/tts', {
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
    toast('Native speech error: ' + err.message);
    return null;
  } finally {
    setPlayNativeLoading(false);
  }
}

function setPlayNativeLoading(loading) {
  const btn = $('btn-play-native');
  btn.disabled = loading;
  btn.innerHTML = loading
    ? `<span class="loading-spinner-small"></span>`
    : `<svg viewBox="0 0 24 24" width="18" height="18"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>`;
}

async function playNative() {
  if (currentNativeSrc) {
    stopNativeAudio();
    return;
  }

  const url = await fetchNativeAudio();
  if (!url) return;

  if (!nativeBuffer) {
    nativeBuffer = await loadAudioBuffer(url);
    if (nativeBuffer) {
      drawWaveform($('canvas-native'), nativeBuffer, 'native');
      $('placeholder-native').classList.add('hidden');
      $('native-duration').textContent = formatDuration(nativeBuffer.duration);
    }
  }

  const speed = $('native-speed') ? parseFloat($('native-speed').value) : 1;
  currentNativeSrc = playBuffer(nativeBuffer, $('btn-play-native'), () => {
    currentNativeSrc = null;
  }, speed);
}

function stopNativeAudio() {
  if (currentNativeSrc) {
    currentNativeSrc.stop();
    currentNativeSrc = null;
  }
}

function playUser() {
  if (currentUserSrc) {
    currentUserSrc.stop();
    currentUserSrc = null;
    return;
  }

  if (!userBuffer) return;
  currentUserSrc = playBuffer(userBuffer, $('btn-play-user'), () => {
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
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><rect x="6" y="6" width="12" height="12" fill="currentColor"/></svg>`;
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
    toast('Could not decode audio waveform');
    return null;
  }
}

function formatDuration(secs) {
  const s = Math.round(secs);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ─── Cross-Platform Microphone Recording ─────────────────────
function getSupportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg'
  ];
  if (window.MediaRecorder) {
    for (const t of candidates) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
  }
  return '';
}

async function startRecord() {
  if (isRecording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    });

    chunks = [];
    finalTranscript = '';
    interimTranscript = '';

    if (recognition) {
      recognition.lang = currentLang;
      recognition.onend = () => {
        if (isRecording) {
          try { recognition.start(); } catch(err) {}
        }
      };
      try { recognition.start(); } catch(err) {}
    }

    const mime = getSupportedMimeType();
    const options = mime ? { mimeType: mime } : undefined;
    mediaRecorder = new MediaRecorder(stream, options);

    mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = onRecordStop;
    mediaRecorder.start(100);
    isRecording = true;

    $('btn-record').classList.add('recording');
    $('btn-record').querySelector('.rec-label').textContent = 'Recording… (Tap to stop)';
    $('record-hint').textContent = 'Speak clearly into your microphone';

  } catch (err) {
    console.error('Microphone error:', err);
    toast('Microphone access denied. Please enable microphone permissions in your browser.');
  }
}

function stopRecord() {
  if (!isRecording || !mediaRecorder) return;

  mediaRecorder.stop();
  if (recognition) {
    recognition.onend = null;
    try { recognition.stop(); } catch(err) {}
  }

  mediaRecorder.stream.getTracks().forEach(t => t.stop());
  isRecording = false;

  $('btn-record').classList.remove('recording');
  $('btn-record').querySelector('.rec-label').textContent = 'Processing…';
  $('record-hint').textContent = 'Analyzing pronunciation accuracy…';
}

async function onRecordStop() {
  const mime = getSupportedMimeType() || 'audio/webm';
  const blob = new Blob(chunks, { type: mime });

  try {
    const raw = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    userBuffer = await ctx.decodeAudioData(raw);

    drawWaveform($('canvas-user'), userBuffer, 'user');
    $('placeholder-user').classList.add('hidden');
    $('user-duration').textContent  = formatDuration(userBuffer.duration);
    $('btn-play-user').disabled = false;

    // Send audio to AI for evaluation and Neon cloud persistence
    await getAIScore(blob);

  } catch (err) {
    console.error('Audio processing error:', err);
    toast('Could not process your recording — please try again');
    $('record-hint').textContent = 'Tap to record again';
    $('btn-record').querySelector('.rec-label').textContent = 'Tap to Record';
  }
}

async function getAIScore(audioBlob) {
  $('record-hint').innerHTML = `<span class="loading-spinner-small"></span> Evaluating your speech with Whisper AI…`;

  // Measure rhythm & volume locally
  const userSecs = userBuffer.duration;
  let rhythm = 0;
  if (nativeBuffer) {
    const nativeSecs = nativeBuffer.duration;
    const ratio = userSecs / nativeSecs;
    const rhythmRatio = ratio > 1 ? (nativeSecs / userSecs) : ratio;
    rhythm = Math.round(rhythmRatio * 100);
  } else {
    rhythm = 80;
  }

  const data = userBuffer.getChannelData(0);
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
    sumSquares += abs * abs;
  }
  const rms = Math.sqrt(sumSquares / (data.length || 1));
  let volume = Math.min(100, Math.round(peak * 120));

  // If microphone captured near-zero acoustic energy (pure silence or faint mic hiss)
  if (peak < 0.035 && rms < 0.005) {
    volume = Math.min(volume, 3);
  }

  currentLang = $('lang-select').value;

  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');
  formData.append('targetText', selectedPhrase);
  formData.append('translation', selectedTranslation || '');
  formData.append('rhythm', rhythm);
  formData.append('volume', volume);
  formData.append('language', currentLang);
  formData.append('voiceId', selectedVoice);

  const headers = {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers,
      body: formData
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Speech scoring service failed');
    }

    const result = await res.json();

    if (result.isSilence || !result.transcript || result.transcript.trim().replace(/[.]/g, '') === '') {
      showScorePanelZero('Voice not detected', '#FF4D85', 'Voice not detected. Please speak clearly into your microphone in the selected language.', 0, 0, result.volume);
      $('record-hint').textContent = 'Voice not detected — please record in the selected language';
    } else if (result.languageMismatch) {
      const expLang = result.expectedLanguage || 'the selected language';
      showScorePanelZero('Language Mismatch', '#FF8A80', `You must record in ${expLang}. Whisper heard: "${result.transcript}"`, 0, 0, result.volume);
      $('record-hint').textContent = `Language mismatch — heard: "${result.transcript}"`;
    } else if (result.accuracy === 0 || result.phraseMismatch) {
      showScorePanelZero('Phrase Mismatch', '#FF8A80', `Whisper heard: "${result.transcript}". Please speak the target phrase in the selected language.`, 0, 0, result.volume);
      $('record-hint').textContent = `Heard: "${result.transcript}" (does not match target phrase)`;
    } else {
      $('record-hint').textContent = 'Listen to the native vs your attempt, then check your score';
      showScore(result.overall, result.rhythm, result.accuracy, result.volume);
    }

    // Indicate cloud save status
    if (result.savedSessionId) {
      $('save-status-badge')?.classList.remove('hidden');
    } else if (!currentUser) {
      $('record-hint').innerHTML = `Score ready! <a href="#" id="link-prompt-auth" style="color:var(--accent-cyan); text-decoration:underline;">Sign in</a> to save recordings to your Dashboard.`;
      $('link-prompt-auth')?.addEventListener('click', (e) => {
        e.preventDefault();
        $('btn-open-login')?.click();
      });
    }

  } catch (err) {
    toast('Scoring Error: ' + err.message);
    $('record-hint').textContent = 'Evaluation error — check connection and try again';
  } finally {
    $('btn-record').querySelector('.rec-label').textContent = 'Tap to Record';
  }
}

// ─── Waveform Canvas Visualizer ──────────────────────────────
function drawWaveform(canvas, buffer, type) {
  const data = buffer.getChannelData(0);
  const W = canvas.offsetWidth  || 320;
  const H = canvas.offsetHeight || 85;
  canvas.width  = W * (window.devicePixelRatio || 1);
  canvas.height = H * (window.devicePixelRatio || 1);
  const ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

  const barW = 3, gap = 2, total = barW + gap;
  const bars  = Math.floor(W / total);
  const chunk = Math.floor(data.length / bars);
  const color = type === 'native' ? '#FF3B7A' : '#00E5FF';
  const dim   = type === 'native' ? 'rgba(255, 59, 122, 0.2)' : 'rgba(0, 229, 255, 0.2)';

  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < bars; i++) {
    let sum = 0;
    for (let j = 0; j < chunk; j++) sum += Math.abs(data[i * chunk + j] || 0);
    const amp  = sum / chunk;
    const barH = Math.max(3, amp * H * 3);
    const x = i * total, y = (H - barH) / 2;
    ctx.fillStyle = amp > 0.015 ? color : dim;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, 2);
    ctx.fill();
  }
}

function clearCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// ─── Score Presentation ──────────────────────────────────────
function showScorePanelZero(title, color, msg, rhythm, accuracy, volume) {
  const scorePanel = $('score-panel');
  scorePanel.classList.remove('hidden');
  $('btn-try-again').classList.remove('hidden');
  $('btn-next-phrase').classList.remove('hidden');

  animateNumber($('score-number'), 0, 800);
  $('ring-fill').style.strokeDashoffset = 314.16;

  $('score-grade').textContent = title;
  $('score-grade').style.color = color;
  $('ring-fill').style.stroke  = color;
  $('score-message').textContent = msg;

  setTimeout(() => {
    $('bar-rhythm').style.width   = rhythm  + '%';
    $('bar-accuracy').style.width = accuracy + '%';
    $('bar-volume').style.width   = volume  + '%';
    $('val-rhythm').textContent   = rhythm  + '%';
    $('val-accuracy').textContent = accuracy + '%';
    $('val-volume').textContent   = volume  + '%';
  }, 150);
}

function showScore(score, rhythm, accuracy, volume) {
  const scorePanel = $('score-panel');
  scorePanel.classList.remove('hidden');
  $('btn-try-again').classList.remove('hidden');
  $('btn-next-phrase').classList.remove('hidden');

  animateNumber($('score-number'), score, 1000);

  const offset = 314.16 * (1 - score / 100);
  requestAnimationFrame(() => { $('ring-fill').style.strokeDashoffset = offset; });

  const grade = GRADE_MAP.find(g => score >= g.min) || GRADE_MAP[GRADE_MAP.length - 1];
  $('score-grade').textContent = grade.grade;
  $('score-grade').style.color = grade.color;
  $('ring-fill').style.stroke  = grade.color;
  $('score-message').textContent = grade.msg;

  setTimeout(() => {
    $('bar-rhythm').style.width   = rhythm  + '%';
    $('bar-accuracy').style.width = accuracy + '%';
    $('bar-volume').style.width   = volume  + '%';
    $('val-rhythm').textContent   = rhythm  + '%';
    $('val-accuracy').textContent = accuracy + '%';
    $('val-volume').textContent   = volume  + '%';
  }, 150);
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

// ─── Voice Speech-to-Text Input ──────────────────────────────
function toggleInputVoice() {
  if (isInputVoiceActive) {
    stopInputVoice();
    return;
  }
  startInputVoice();
}

async function startInputVoice() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    inputChunks = [];
    inputMediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() || undefined });

    inputMediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) inputChunks.push(e.data);
    };

    inputMediaRecorder.onstop = onInputRecordStop;
    inputMediaRecorder.start();
    isInputVoiceActive = true;
    $('btn-input-mic')?.classList.add('active');
  } catch (err) {
    console.error('Mic access denied:', err);
    toast('Microphone access denied');
  }
}

function stopInputVoice() {
  if (inputMediaRecorder && isInputVoiceActive) {
    inputMediaRecorder.stop();
    inputMediaRecorder.stream.getTracks().forEach(t => t.stop());
    isInputVoiceActive = false;
    $('btn-input-mic')?.classList.remove('active');
  }
}

async function onInputRecordStop() {
  const btn = $('btn-input-mic');
  const blob = new Blob(inputChunks, { type: getSupportedMimeType() || 'audio/webm' });
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<span class="loading-spinner-small"></span>`;
  btn.disabled = true;

  const formData = new FormData();
  formData.append('audio', blob, 'recording.webm');

  try {
    const res = await fetch('/api/transcribe', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) throw new Error('Transcription failed');
    const data = await res.json();
    if (data.transcript) {
      $('custom-phrase').value = data.transcript;
      $('custom-phrase').dispatchEvent(new Event('input'));
    }
  } catch (err) {
    toast('Transcription failed: ' + err.message);
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
}

// ─── Utilities ───────────────────────────────────────────────
function formatRelativeDate(isoStr) {
  if (!isoStr) return '';
  const date = new Date(isoStr);
  const now = new Date();
  const diffSecs = Math.round((now - date) / 1000);

  if (diffSecs < 60) return 'Just now';
  if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
  if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
  if (diffSecs < 604800) return `${Math.floor(diffSecs / 86400)}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getLanguageDisplayName(code) {
  const map = {
    'ta-IN': 'Tamil',
    'mr-IN': 'Marathi',
    'hi-IN': 'Hindi',
    'en-IN': 'English (IN)',
    'ja-JP': 'Japanese',
    'pt-BR': 'Portuguese',
    'de-DE': 'German',
    'fr-FR': 'French',
    'es-ES': 'Spanish (ES)',
    'es-MX': 'Spanish (MX)',
    'it-IT': 'Italian',
  };
  return map[code] || code || 'Target';
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[m]));
}

let toastTimeout;
function toast(msg) {
  const toastEl = $('toast');
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toastEl.classList.add('hidden'), 3500);
}

// ─── Launch ──────────────────────────────────────────────────
init();
