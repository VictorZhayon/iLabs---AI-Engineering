import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  updateProfile, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';

// Firebase Client configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const API_URL = '/api/analyze';
const AUTH_API = '/api/auth';
const HISTORY_API = '/api/history';

// --- UI ELEMENTS ---
const authSection = document.getElementById('authSection');
const onboardingSection = document.getElementById('onboardingSection');
const mainSection = document.getElementById('mainSection');
const userProfileContainer = document.getElementById('userProfileContainer');

const logoutBtn = document.getElementById('logoutBtn');
const profileName = document.getElementById('profileName');
const profileEmail = document.getElementById('profileEmail');

const authForm = document.getElementById('authForm');
const authTitle = document.getElementById('authTitle');
const authSubtitle = document.getElementById('authSubtitle');
const authSubmitText = document.getElementById('authSubmitText');
const authSwitchText = document.getElementById('authSwitchText');
const authError = document.getElementById('authError');
const authLoader = document.getElementById('authLoader');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const nameInput = document.getElementById('name');
const nameGroup = document.getElementById('nameGroup');

const otpForm = document.getElementById('otpForm');
const otpCode = document.getElementById('otpCode');
const otpError = document.getElementById('otpError');
const otpSuccess = document.getElementById('otpSuccess');
const otpSubmitText = document.getElementById('otpSubmitText');
const otpLoader = document.getElementById('otpLoader');
const resendOtpBtn = document.getElementById('resendOtpBtn');

let isLoginMode = true;
let currentUser = null;
let currentResultsData = null;

// Helper: Escape HTML strings to prevent XSS injection
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Toast notification helper (replaces browser alerts)
function showToast(message, type = 'info') {
  let toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toastContainer';
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" title="Dismiss" type="button">&times;</button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 250);
  });

  toastContainer.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 250);
    }
  }, 3500);
}

// Helper: Always fetch a fresh, non-expired ID token from Firebase
async function getAuthToken(forceRefresh = false) {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(forceRefresh);
  } catch (err) {
    console.error("Failed to acquire valid ID token:", err);
    return null;
  }
}

// --- AUTH STATE OBSERVER ---
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    profileName.textContent = user.displayName || 'Developer';
    profileEmail.textContent = user.email || '';
    
    // Safely check latest verification status
    try {
      await user.reload();
    } catch (reloadErr) {
      console.warn("Could not reload user record:", reloadErr.message);
    }

    if (user.emailVerified) {
      showMain();
      fetchHistory();
    } else {
      showOnboarding();
      if (!sessionStorage.getItem('otp_requested')) {
        requestOTP();
      }
    }
  } else {
    currentUser = null;
    sessionStorage.removeItem('otp_requested');
    showAuth();
  }
});

function showAuth() {
  authSection.classList.remove('hidden');
  onboardingSection.classList.add('hidden');
  mainSection.classList.add('hidden');
  userProfileContainer.classList.add('hidden');
}

function showOnboarding() {
  authSection.classList.add('hidden');
  onboardingSection.classList.remove('hidden');
  mainSection.classList.add('hidden');
  userProfileContainer.classList.remove('hidden');
}

function showMain() {
  authSection.classList.add('hidden');
  onboardingSection.classList.add('hidden');
  mainSection.classList.remove('hidden');
  userProfileContainer.classList.remove('hidden');
}

// Event delegation for Login / Signup mode toggle
if (authSwitchText) {
  authSwitchText.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'toggleAuthMode') {
      e.preventDefault();
      isLoginMode = !isLoginMode;
      authError.classList.add('hidden');
      
      if (isLoginMode) {
        nameGroup.classList.add('hidden');
        nameInput.required = false;
        authTitle.textContent = 'Welcome Back';
        authSubtitle.textContent = 'Log in to your account';
        authSubmitText.textContent = 'Log In';
        authSwitchText.innerHTML = `Don't have an account? <a href="#" id="toggleAuthMode">Sign up</a>`;
      } else {
        nameGroup.classList.remove('hidden');
        nameInput.required = true;
        authTitle.textContent = 'Create Account';
        authSubtitle.textContent = 'Sign up to get started';
        authSubmitText.textContent = 'Sign Up';
        authSwitchText.innerHTML = `Already have an account? <a href="#" id="toggleAuthMode">Log in</a>`;
      }
    }
  });
}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  if (!email || !password || (!isLoginMode && !name)) return;
  
  authError.classList.add('hidden');
  authSubmitText.textContent = isLoginMode ? 'Logging in...' : 'Signing up...';
  authLoader.classList.remove('hidden');
  const btn = authForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  
  try {
    if (isLoginMode) {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, { displayName: name });
      profileName.textContent = name;
    }
  } catch (err) {
    authError.textContent = err.message.replace('Firebase: ', '');
    authError.classList.remove('hidden');
  } finally {
    authSubmitText.textContent = isLoginMode ? 'Log In' : 'Sign Up';
    authLoader.classList.add('hidden');
    btn.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  sessionStorage.removeItem('otp_requested');
  await signOut(auth);
  showToast('Logged out successfully', 'info');
});

// --- OTP / VERIFICATION LOGIC ---
async function requestOTP() {
  const token = await getAuthToken();
  if (!token) return;

  try {
    sessionStorage.setItem('otp_requested', 'true');
    otpError.classList.add('hidden');
    otpSuccess.classList.remove('hidden');
    otpSuccess.textContent = 'Requesting code...';
    
    const response = await fetch(`${AUTH_API}/request-otp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to request verification code');
    }
    
    otpSuccess.textContent = 'A 6-digit code has been sent to your email!';
  } catch (err) {
    otpSuccess.classList.add('hidden');
    otpError.textContent = err.message;
    otpError.classList.remove('hidden');
  }
}

resendOtpBtn.addEventListener('click', (e) => {
  e.preventDefault();
  requestOTP();
});

// Format OTP code input to digits only
otpCode.addEventListener('input', () => {
  otpCode.value = otpCode.value.replace(/\D/g, '').slice(0, 6);
});

otpForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = otpCode.value.trim();
  if (code.length !== 6) {
    otpError.textContent = 'Please enter a valid 6-digit code';
    otpError.classList.remove('hidden');
    return;
  }
  
  otpError.classList.add('hidden');
  otpSuccess.classList.add('hidden');
  otpSubmitText.textContent = 'Verifying...';
  otpLoader.classList.remove('hidden');
  const btn = otpForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  
  try {
    const token = await getAuthToken(true);
    const response = await fetch(`${AUTH_API}/verify-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ otp: code })
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Invalid verification code');
    
    // Successfully verified: reload user and refresh token
    if (auth.currentUser) {
      await auth.currentUser.reload();
      await getAuthToken(true);
    }
    
    showToast('Email verified successfully! Welcome to CodeSense.', 'success');
    showMain();
    fetchHistory();
  } catch (err) {
    otpError.textContent = err.message;
    otpError.classList.remove('hidden');
  } finally {
    otpSubmitText.textContent = 'Verify';
    otpLoader.classList.add('hidden');
    btn.disabled = false;
  }
});

// --- PWA SERVICE WORKER REGISTRATION ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      console.log('CodeSense Service Worker registered:', reg.scope);
    }).catch(err => {
      console.warn('CodeSense Service Worker registration failed:', err);
    });
  });
}

// --- HISTORY LOGIC ---
const historySidebar = document.getElementById('historySidebar');
const historyToggleBtn = document.getElementById('historyToggleBtn');
const historyToggleBtnMain = document.getElementById('historyToggleBtnMain');
const historyList = document.getElementById('historyList');
const historyEmpty = document.getElementById('historyEmpty');
const mainLayout = document.querySelector('.main-layout');
let historyData = [];

function getCodePreview(code) {
  if (!code) return '';
  const inline = code.replace(/\r?\n/g, ' ').trim();
  return inline.length > 50 ? inline.substring(0, 50) + '...' : inline;
}

function formatTimeAgo(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function fetchHistory() {
  const token = await getAuthToken();
  if (!token) return;
  
  try {
    const res = await fetch(HISTORY_API, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to fetch history');
    historyData = await res.json();
    renderHistory();
  } catch (err) {
    console.error('History fetch error:', err.message);
  }
}

function renderHistory() {
  historyList.innerHTML = '';
  if (!historyData || historyData.length === 0) {
    historyEmpty.classList.remove('hidden');
    return;
  }
  
  historyEmpty.classList.add('hidden');
  historyData.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item fade-in';
    div.dataset.id = item.id;
    
    // Use escapeHtml to prevent XSS injection from code snippets
    div.innerHTML = `
      <button class="delete-history-btn" title="Delete entry" data-id="${escapeHtml(item.id)}" type="button">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
        </svg>
      </button>
      <div class="history-item-header">
        <span class="language-badge">${escapeHtml(item.language || 'code')}</span>
        <span class="history-time">${escapeHtml(formatTimeAgo(item.createdAt))}</span>
      </div>
      <div class="history-code-preview">${escapeHtml(getCodePreview(item.code))}</div>
    `;
    
    div.addEventListener('click', (e) => {
      if (e.target.closest('.delete-history-btn')) return;
      
      document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
      div.classList.add('active');
      
      codeInput.value = item.code;
      let resData = item.result;
      if (typeof resData === 'string') {
        try { resData = JSON.parse(resData); } catch(e) {}
      }
      renderResults(resData);
    });
    
    const delBtn = div.querySelector('.delete-history-btn');
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Are you sure you want to delete this analysis?')) return;
      await deleteHistory(item.id);
    });
    
    historyList.appendChild(div);
  });
}

async function deleteHistory(id) {
  const token = await getAuthToken();
  if (!token) return;
  
  try {
    const res = await fetch(`${HISTORY_API}/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      showToast('Analysis removed from history', 'info');
      const activeItem = document.querySelector(`.history-item.active[data-id="${id}"]`);
      if (activeItem) {
        codeInput.value = '';
        resultsSection.classList.add('hidden');
        currentResultsData = null;
      }
      await fetchHistory();
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to delete history entry', 'error');
    }
  } catch (err) {
    console.error('Error deleting history:', err);
    showToast('Network error while deleting entry', 'error');
  }
}

const toggleSidebar = () => {
  historySidebar.classList.toggle('collapsed');
  if (mainLayout) {
    mainLayout.classList.toggle('sidebar-closed');
  }
};
if (historyToggleBtn) historyToggleBtn.addEventListener('click', toggleSidebar);
if (historyToggleBtnMain) historyToggleBtnMain.addEventListener('click', toggleSidebar);

// --- MAIN ANALYSIS & ACTIONS ---
const analyzeBtn = document.getElementById('analyzeBtn');
const clearBtn = document.getElementById('clearBtn');
const copyAnalysisBtn = document.getElementById('copyAnalysisBtn');
const copyAnalysisText = document.getElementById('copyAnalysisText');
const codeInput = document.getElementById('codeInput');
const btnText = analyzeBtn.querySelector('.btn-text');
const loader = analyzeBtn.querySelector('.loader');

const resultsSection = document.getElementById('resultsSection');
const explanationContent = document.getElementById('explanationContent');
const issuesList = document.getElementById('issuesList');
const suggestionsList = document.getElementById('suggestionsList');

// Clear Editor & Results
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    codeInput.value = '';
    resultsSection.classList.add('hidden');
    currentResultsData = null;
    document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
    codeInput.focus();
  });
}

// Keyboard Shortcut: Ctrl+Enter (or Cmd+Enter) to analyze, Esc to clear
codeInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    analyzeBtn.click();
  }
});

// Copy Analysis Report to Clipboard
if (copyAnalysisBtn) {
  copyAnalysisBtn.addEventListener('click', async () => {
    if (!currentResultsData) return;
    
    let report = `# CodeSense AI Analysis Report\n\n`;
    report += `## Explanation\n${currentResultsData.explanation || 'N/A'}\n\n`;
    
    report += `## Potential Issues\n`;
    if (currentResultsData.issues && currentResultsData.issues.length > 0) {
      currentResultsData.issues.forEach(issue => {
        report += `- ${issue}\n`;
      });
    } else {
      report += `No major issues detected.\n`;
    }
    report += `\n`;

    report += `## Suggestions\n`;
    if (currentResultsData.suggestions && currentResultsData.suggestions.length > 0) {
      currentResultsData.suggestions.forEach(sugg => {
        report += `- ${sugg}\n`;
      });
    } else {
      report += `No suggestions at this time.\n`;
    }

    try {
      await navigator.clipboard.writeText(report);
      copyAnalysisText.textContent = 'Copied!';
      showToast('Analysis report copied to clipboard!', 'success');
      setTimeout(() => {
        copyAnalysisText.textContent = 'Copy Report';
      }, 2000);
    } catch (clipErr) {
      console.warn("Clipboard write failed:", clipErr);
      showToast('Failed to copy to clipboard', 'error');
    }
  });
}

analyzeBtn.addEventListener('click', async () => {
  const code = codeInput.value.trim();
  
  if (!code) {
    showToast('Please enter or paste code to analyze.', 'info');
    codeInput.focus();
    return;
  }

  // Refresh token before sending request
  const token = await getAuthToken();
  if (!token) {
    showToast('Your session has expired. Please log in again.', 'info');
    await signOut(auth);
    return;
  }

  // UI state: loading
  analyzeBtn.disabled = true;
  btnText.textContent = 'Analyzing...';
  loader.classList.remove('hidden');
  resultsSection.classList.add('hidden');
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ code }),
    });

    if (response.status === 401) {
      await signOut(auth);
      showToast('Session expired. Please log in again.', 'info');
      return;
    }

    const data = await response.json();

    if (response.status === 403 && data.error && data.error.includes('Email must be verified')) {
      showToast('Please verify your email before analyzing code.', 'info');
      showOnboarding();
      requestOTP();
      return;
    }
    
    if (!response.ok) {
      throw new Error(data.error || `Error ${response.status}: Failed to analyze code`);
    }

    currentResultsData = data;
    renderResults(data);
    await fetchHistory(); // refresh sidebar with new entry
  } catch (error) {
    console.error('Failed to analyze code:', error);
    showToast(error.message || 'Failed to analyze code.', 'error');
  } finally {
    analyzeBtn.disabled = false;
    btnText.textContent = 'Analyze';
    loader.classList.add('hidden');
  }
});

function renderResults(data) {
  if (!data) return;
  currentResultsData = data;

  // Clear previous results
  explanationContent.innerHTML = '';
  issuesList.innerHTML = '';
  suggestionsList.innerHTML = '';

  // Render Explanation safely
  const p = document.createElement('p');
  p.textContent = data.explanation || 'No explanation provided.';
  explanationContent.appendChild(p);

  // Render Issues safely
  if (data.issues && Array.isArray(data.issues) && data.issues.length > 0) {
    data.issues.forEach(issue => {
      const li = document.createElement('li');
      li.textContent = issue;
      issuesList.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.textContent = 'No major issues detected.';
    issuesList.appendChild(li);
  }

  // Render Suggestions safely
  if (data.suggestions && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
    data.suggestions.forEach(suggestion => {
      const li = document.createElement('li');
      li.textContent = suggestion;
      suggestionsList.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.textContent = 'No suggestions right now. Code looks solid!';
    suggestionsList.appendChild(li);
  }

  // Show results
  resultsSection.classList.remove('hidden');
  
  // Scroll to results smoothly
  setTimeout(() => {
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}
