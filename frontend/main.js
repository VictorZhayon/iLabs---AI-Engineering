import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut, onAuthStateChanged } from 'firebase/auth';

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
let currentToken = null;

// --- AUTH STATE OBSERVER ---
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    currentToken = await user.getIdToken();
    profileName.textContent = user.displayName || 'User';
    profileEmail.textContent = user.email;
    
    // Check if verified
    await user.reload(); // Ensure we have the latest verified status
    if (user.emailVerified) {
      showMain();
      if (typeof fetchHistory === 'function') fetchHistory();
    } else {
      showOnboarding();
      // Auto request OTP if first time
      if (!sessionStorage.getItem('otp_requested')) {
        requestOTP();
      }
    }
  } else {
    currentToken = null;
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

function attachToggleEvent() {
  const toggleBtn = document.getElementById('toggleAuthMode');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
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
      attachToggleEvent();
    });
  }
}
attachToggleEvent();

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  if (!email || !password || (!isLoginMode && !name)) return;
  
  authError.classList.add('hidden');
  authSubmitText.textContent = isLoginMode ? 'Logging in...' : 'Signing up...';
  authLoader.classList.remove('hidden');
  const btn = authForm.querySelector('button');
  btn.disabled = true;
  
  try {
    if (isLoginMode) {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, { displayName: name });
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

logoutBtn.addEventListener('click', () => {
  signOut(auth);
});

// --- OTP LOGIC ---
async function requestOTP() {
  if (!currentToken) return;
  try {
    sessionStorage.setItem('otp_requested', 'true');
    otpError.classList.add('hidden');
    otpSuccess.classList.remove('hidden');
    otpSuccess.textContent = 'Requesting code...';
    
    const response = await fetch(`${AUTH_API}/request-otp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${currentToken}`
      }
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to request OTP');
    
    otpSuccess.textContent = 'Code sent to your email!';
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

otpForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = otpCode.value.trim();
  if (code.length !== 6) return;
  
  otpError.classList.add('hidden');
  otpSuccess.classList.add('hidden');
  otpSubmitText.textContent = 'Verifying...';
  otpLoader.classList.remove('hidden');
  const btn = otpForm.querySelector('button');
  btn.disabled = true;
  
  try {
    // Refresh token just in case
    currentToken = await currentUser.getIdToken(true);
    const response = await fetch(`${AUTH_API}/verify-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ otp: code })
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Invalid OTP');
    
    // Successfully verified!
    // Reload user to get new verified status
    await currentUser.reload();
    // Force token refresh to pick up custom claims if any
    currentToken = await currentUser.getIdToken(true);
    
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
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('SW registered:', registration);
    }).catch(registrationError => {
      console.log('SW registration failed:', registrationError);
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
const HISTORY_API = 'http://localhost:3000/api/history';
let historyData = [];

function getCodePreview(code) {
  const inline = code.replace(/\n/g, ' ').trim();
  return inline.length > 50 ? inline.substring(0, 50) + '...' : inline;
}

function formatTimeAgo(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

async function fetchHistory() {
  if (!currentToken) return;
  
  try {
    const res = await fetch(HISTORY_API, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (!res.ok) throw new Error('Failed to fetch history');
    historyData = await res.json();
    renderHistory();
  } catch (err) {
    console.error(err);
  }
}

function renderHistory() {
  historyList.innerHTML = '';
  if (historyData.length === 0) {
    historyEmpty.classList.remove('hidden');
    return;
  }
  
  historyEmpty.classList.add('hidden');
  historyData.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item fade-in';
    div.dataset.id = item.id;
    div.innerHTML = `
      <button class="delete-history-btn" title="Delete entry" data-id="${item.id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      </button>
      <div class="history-item-header">
        <span class="language-badge">${item.language}</span>
        <span class="history-time">${formatTimeAgo(item.createdAt)}</span>
      </div>
      <div class="history-code-preview">${getCodePreview(item.code)}</div>
    `;
    
    div.addEventListener('click', (e) => {
      if (e.target.closest('.delete-history-btn')) return;
      
      document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
      div.classList.add('active');
      
      codeInput.value = item.code;
      renderResults(item.result);
    });
    
    const delBtn = div.querySelector('.delete-history-btn');
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this history entry?')) return;
      await deleteHistory(item.id);
    });
    
    historyList.appendChild(div);
  });
}

async function deleteHistory(id) {
  if (!currentToken) return;
  try {
    const res = await fetch(`${HISTORY_API}/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (res.ok) {
      const activeItem = document.querySelector(`.history-item.active[data-id="${id}"]`);
      if (activeItem) {
        codeInput.value = '';
        resultsSection.classList.add('hidden');
      }
      await fetchHistory();
    }
  } catch (err) {
    console.error('Error deleting history:', err);
  }
}

const toggleSidebar = () => {
  historySidebar.classList.toggle('collapsed');
  if (mainLayout) mainLayout.classList.toggle('sidebar-closed');
};
if (historyToggleBtn) historyToggleBtn.addEventListener('click', toggleSidebar);
if (historyToggleBtnMain) historyToggleBtnMain.addEventListener('click', toggleSidebar);
// --- END HISTORY LOGIC ---

const analyzeBtn = document.getElementById('analyzeBtn');
const codeInput = document.getElementById('codeInput');
const btnText = analyzeBtn.querySelector('.btn-text');
const loader = analyzeBtn.querySelector('.loader');

const resultsSection = document.getElementById('resultsSection');
const explanationContent = document.getElementById('explanationContent');
const issuesList = document.getElementById('issuesList');
const suggestionsList = document.getElementById('suggestionsList');

analyzeBtn.addEventListener('click', async () => {
  const code = codeInput.value.trim();
  
  if (!code) {
    alert('Please enter some code to analyze.');
    return;
  }

  // UI state: loading
  analyzeBtn.disabled = true;
  btnText.textContent = 'Analyzing...';
  loader.classList.remove('hidden');
  
  // Hide results if they were visible
  resultsSection.classList.add('hidden');
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ code }),
    });

    if (response.status === 401 || response.status === 403) {
      signOut(auth);
      throw new Error('Session expired. Please log in again.');
    }
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `Error: ${response.statusText}`);
    }

    renderResults(data);
    await fetchHistory(); // refresh sidebar
  } catch (error) {
    console.error('Failed to analyze code:', error);
    alert(error.message || 'Failed to analyze code.');
  } finally {
    // Restore UI state
    analyzeBtn.disabled = false;
    btnText.textContent = 'Analyze';
    loader.classList.add('hidden');
  }
});

function renderResults(data) {
  // Clear previous results
  explanationContent.innerHTML = '';
  issuesList.innerHTML = '';
  suggestionsList.innerHTML = '';

  // Render Explanation
  const p = document.createElement('p');
  p.textContent = data.explanation || 'No explanation provided.';
  explanationContent.appendChild(p);

  // Render Issues
  if (data.issues && data.issues.length > 0) {
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

  // Render Suggestions
  if (data.suggestions && data.suggestions.length > 0) {
    data.suggestions.forEach(suggestion => {
      const li = document.createElement('li');
      li.textContent = suggestion;
      suggestionsList.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.textContent = 'No suggestions right now. Code looks good!';
    suggestionsList.appendChild(li);
  }

  // Show results
  resultsSection.classList.remove('hidden');
  
  // Scroll to results smoothly
  setTimeout(() => {
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}
