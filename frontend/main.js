const API_URL = 'http://localhost:3000/api/analyze';
const AUTH_API = 'http://localhost:3000/api';

// --- AUTHENTICATION LOGIC ---
const authSection = document.getElementById('authSection');
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

let isLoginMode = true;

function checkAuth() {
  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('user');
  if (token && userStr) {
    const user = JSON.parse(userStr);
    profileName.textContent = user.name;
    profileEmail.textContent = user.email;
    
    authSection.classList.add('hidden');
    mainSection.classList.remove('hidden');
    userProfileContainer.classList.remove('hidden');
  } else {
    authSection.classList.remove('hidden');
    mainSection.classList.add('hidden');
    userProfileContainer.classList.add('hidden');
  }
}
checkAuth();

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
      attachToggleEvent(); // Re-attach to new element
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
    const endpoint = isLoginMode ? '/login' : '/signup';
    const payload = isLoginMode ? { email, password } : { name, email, password };
    const response = await fetch(`${AUTH_API}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Authentication failed');
    
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    checkAuth();
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove('hidden');
  } finally {
    authSubmitText.textContent = isLoginMode ? 'Log In' : 'Sign Up';
    authLoader.classList.add('hidden');
    btn.disabled = false;
  }
});

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  checkAuth();
});
// --- END AUTHENTICATION LOGIC ---

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
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ code }),
    });

    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem('token');
      checkAuth();
      throw new Error('Session expired. Please log in again.');
    }
    if (!response.ok) {
      throw new Error(`Error: ${response.statusText}`);
    }

    const data = await response.json();
    renderResults(data);
  } catch (error) {
    console.error('Failed to analyze code:', error);
    alert('Failed to analyze code. Make sure the backend server is running and your API key is set.');
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
