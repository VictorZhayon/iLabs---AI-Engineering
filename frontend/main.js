const API_URL = 'http://localhost:3000/api/analyze';

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
      },
      body: JSON.stringify({ code }),
    });

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
