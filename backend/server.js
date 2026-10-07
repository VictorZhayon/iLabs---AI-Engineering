const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here_for_development';
const users = []; // In-memory user database
const history = []; // In-memory history database

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize Google Gen AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Auth Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token == null) return res.status(401).json({ error: 'Authentication token required' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token' });
        req.user = user;
        next();
    });
};

app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email and password are required' });
        }
        
        if (users.find(u => u.email === email)) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = { id: Date.now().toString(), name, email, password: hashedPassword };
        users.push(newUser);
        
        const token = jwt.sign({ id: newUser.id, name: newUser.name, email: newUser.email }, JWT_SECRET, { expiresIn: '24h' });
        res.status(201).json({ token, user: { name: newUser.name, email: newUser.email }, message: 'User created successfully' });
    } catch (error) {
        console.error("Signup error:", error);
        res.status(500).json({ error: 'Error creating user' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = users.find(u => u.email === email);
        
        if (!user) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { name: user.name, email: user.email }, message: 'Logged in successfully' });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: 'Error logging in' });
    }
});

app.post('/api/analyze', authenticateToken, async (req, res) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Code is required' });
        }

        const prompt = `Analyze the following code snippet. 
Provide a clear explanation of what the code does.
Identify any potential issues, bugs, or anti-patterns.
Offer actionable suggestions for improvement (e.g., performance, readability, best practices).

Return ONLY a valid JSON object with exactly the following structure:
{
  "explanation": "A string explaining the code",
  "issues": ["Issue 1", "Issue 2"],
  "suggestions": ["Suggestion 1", "Suggestion 2"]
}

Code to analyze:
\`\`\`
${code}
\`\`\`
`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
            }
        });

        const textResponse = response.text;
        
        // Parse the JSON response
        let result;
        try {
            // Sometimes Gemini wraps the JSON in markdown blocks even with responseMimeType set
            const cleanedText = textResponse.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            result = JSON.parse(cleanedText);
        } catch (parseError) {
            console.error("Failed to parse JSON response:", textResponse);
            return res.status(500).json({ error: 'Invalid response format from AI' });
        }

        // Auto-save to history
        const historyEntry = {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            userId: req.user.id,
            code,
            result,
            language: detectLanguage(code),
            createdAt: new Date().toISOString()
        };
        history.push(historyEntry);

        res.json(result);

    } catch (error) {
        console.error("Error analyzing code:", error);
        res.status(500).json({ error: 'Failed to analyze code' });
    }
});

// --- HISTORY ROUTES ---

// Simple language detection heuristic
function detectLanguage(code) {
    const trimmed = code.trim();
    if (/^\s*(import |from .+ import |def |class .+:)/m.test(trimmed)) return 'python';
    if (/^\s*(package |func |import \()/m.test(trimmed)) return 'go';
    if (/^\s*(use |fn |let mut |impl |struct )/m.test(trimmed)) return 'rust';
    if (/^\s*(public class|private |System\.out)/m.test(trimmed)) return 'java';
    if (/^\s*(#include|int main|printf|void )/m.test(trimmed)) return 'c/c++';
    if (/<[a-zA-Z][^>]*>/.test(trimmed) && /<\/[a-zA-Z]+>/.test(trimmed)) return 'html';
    if (/^\s*(SELECT |INSERT |UPDATE |DELETE |CREATE TABLE)/mi.test(trimmed)) return 'sql';
    if (/\b(interface |type .+ = |: string|: number)\b/.test(trimmed)) return 'typescript';
    if (/\b(const |let |var |function |=>|require\(|import )/.test(trimmed)) return 'javascript';
    return 'unknown';
}

// Get all history for the authenticated user (newest first)
app.get('/api/history', authenticateToken, (req, res) => {
    const userHistory = history
        .filter(entry => entry.userId === req.user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(userHistory);
});

// Get a single history entry by ID
app.get('/api/history/:id', authenticateToken, (req, res) => {
    const entry = history.find(e => e.id === req.params.id && e.userId === req.user.id);
    if (!entry) {
        return res.status(404).json({ error: 'History entry not found' });
    }
    res.json(entry);
});

// Delete a single history entry by ID
app.delete('/api/history/:id', authenticateToken, (req, res) => {
    const index = history.findIndex(e => e.id === req.params.id && e.userId === req.user.id);
    if (index === -1) {
        return res.status(404).json({ error: 'History entry not found' });
    }
    history.splice(index, 1);
    res.json({ message: 'History entry deleted' });
});

app.listen(port, () => {
    console.log(`Backend server running on http://localhost:${port}`);
});
