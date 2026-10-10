const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize Google Gen AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Initialize Firebase Admin
let db;
let adminAuth;
try {
    let serviceAccount;
    const serviceAccountPath = './serviceAccountKey.json';
    
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        // Load from environment variable in production (Vercel)
        try {
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        } catch (parseError) {
            console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT environment variable. Ensure it is valid JSON.", parseError);
        }
    } else if (fs.existsSync(serviceAccountPath)) {
        // Load from local file during development
        serviceAccount = require(serviceAccountPath);
    }

    if (serviceAccount && serviceAccount.project_id !== "REPLACE_ME") {
        // Vercel Serverless containers can be reused, so only initialize if no apps exist
        if (getApps().length === 0) {
            initializeApp({
                credential: cert(serviceAccount)
            });
            console.log("Firebase Admin initialized successfully.");
        }
        db = getFirestore();
        adminAuth = getAuth();
    } else {
        console.warn("Firebase credentials not found or are placeholders. Firebase Admin is not initialized.");
    }
} catch (error) {
    console.error("Error initializing Firebase Admin:", error);
}

// Auth Middleware using Firebase Admin
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token == null) return res.status(401).json({ error: 'Authentication token required' });

    if (getApps().length === 0) {
        return res.status(500).json({ error: 'Firebase Admin not initialized properly on the server' });
    }

    try {
        const decodedToken = await adminAuth.verifyIdToken(token);
        req.user = decodedToken; // decodedToken contains uid, email, email_verified, etc.
        next();
    } catch (error) {
        console.error("Token verification error:", error);
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

// --- AUTH / OTP ROUTES ---

app.post('/api/auth/request-otp', authenticateToken, async (req, res) => {
    if (!db) return res.status(500).json({ error: 'Database not initialized' });

    try {
        const uid = req.user.uid;
        const email = req.user.email;
        const name = req.user.name || 'User';

        // Rate limiting check: No more than 1 request per minute
        const oneMinuteAgo = Date.now() - 60 * 1000;
        const docRef = db.collection('otp_verifications').doc(uid);
        const doc = await docRef.get();

        if (doc.exists) {
            if (doc.data().createdAt > oneMinuteAgo) {
                return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
            }
        }

        // Generate 6-digit OTP securely
        const otp = crypto.randomInt(100000, 999999).toString();
        
        // Expiration: 10 minutes from now
        const expiresAt = Date.now() + 10 * 60 * 1000;

        // Save to Firestore
        await db.collection('otp_verifications').doc(uid).set({
            uid,
            email,
            otp,
            expiresAt,
            createdAt: Date.now()
        });

        // Send via EmailJS REST API
        const emailjsResponse = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service_id: process.env.EMAILJS_SERVICE_ID,
                template_id: process.env.EMAILJS_TEMPLATE_ID,
                user_id: process.env.EMAILJS_PUBLIC_KEY,
                accessToken: process.env.EMAILJS_PRIVATE_KEY,
                template_params: {
                    to_email: email,
                    to_name: name,
                    otp_code: otp
                }
            })
        });

        if (!emailjsResponse.ok) {
            const errText = await emailjsResponse.text();
            console.error('EmailJS Error:', errText);
            throw new Error('Failed to send email via EmailJS');
        }

        res.json({ message: 'OTP sent successfully' });

    } catch (error) {
        console.error("Error requesting OTP:", error);
        res.status(500).json({ error: 'Failed to send OTP. Please try again later.' });
    }
});

app.post('/api/auth/verify-otp', authenticateToken, async (req, res) => {
    if (!db) return res.status(500).json({ error: 'Database not initialized' });

    try {
        const { otp } = req.body;
        const uid = req.user.uid;

        if (!otp) return res.status(400).json({ error: 'OTP is required' });

        const docRef = db.collection('otp_verifications').doc(uid);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(400).json({ error: 'No OTP request found for this user.' });
        }

        const data = doc.data();

        if (Date.now() > data.expiresAt) {
            return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
        }

        if (data.otp !== otp) {
            return res.status(400).json({ error: 'Invalid OTP.' });
        }

        // OTP is valid and not expired
        // Mark user as email verified in Firebase Auth
        await adminAuth.updateUser(uid, {
            emailVerified: true
        });

        // Delete the OTP document so it cannot be reused
        await docRef.delete();

        res.json({ message: 'Email verified successfully.' });

    } catch (error) {
        console.error("Error verifying OTP:", error);
        res.status(500).json({ error: 'Failed to verify OTP' });
    }
});

// --- MAIN ROUTES ---

app.post('/api/analyze', authenticateToken, async (req, res) => {
    // Ensure email is verified
    if (!req.user.email_verified) {
        return res.status(403).json({ error: 'Email must be verified to use this feature.' });
    }

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
        
        let result;
        try {
            const cleanedText = textResponse.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            result = JSON.parse(cleanedText);
        } catch (parseError) {
            console.error("Failed to parse JSON response:", textResponse);
            return res.status(500).json({ error: 'Invalid response format from AI' });
        }

        const historyEntry = {
            userId: req.user.uid,
            code,
            result,
            language: detectLanguage(code),
            createdAt: new Date().toISOString()
        };

        if (db) {
            const docRef = await db.collection('history').add(historyEntry);
            historyEntry.id = docRef.id;
        } else {
            historyEntry.id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        }

        res.json(result);

    } catch (error) {
        console.error("Error analyzing code:", error);
        res.status(500).json({ error: 'Failed to analyze code' });
    }
});

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
app.get('/api/history', authenticateToken, async (req, res) => {
    if (!db) return res.json([]);
    
    try {
        const snapshot = await db.collection('history')
            .where('userId', '==', req.user.uid)
            .get();
            
        const userHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        userHistory.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(userHistory);
    } catch (error) {
        console.error("Error fetching history:", error);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

// Get a single history entry by ID
app.get('/api/history/:id', authenticateToken, async (req, res) => {
    if (!db) return res.status(404).json({ error: 'Database not initialized' });
    
    try {
        const docRef = db.collection('history').doc(req.params.id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data().userId !== req.user.uid) {
            return res.status(404).json({ error: 'History entry not found' });
        }
        res.json({ id: doc.id, ...doc.data() });
    } catch (error) {
        console.error("Error fetching history entry:", error);
        res.status(500).json({ error: 'Failed to fetch history entry' });
    }
});

// Delete a single history entry by ID
app.delete('/api/history/:id', authenticateToken, async (req, res) => {
    if (!db) return res.status(404).json({ error: 'Database not initialized' });
    
    try {
        const docRef = db.collection('history').doc(req.params.id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data().userId !== req.user.uid) {
            return res.status(404).json({ error: 'History entry not found' });
        }
        await docRef.delete();
        res.json({ message: 'History entry deleted' });
    } catch (error) {
        console.error("Error deleting history entry:", error);
        res.status(500).json({ error: 'Failed to delete history entry' });
    }
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Backend server running on http://localhost:${port}`);
    });
}

module.exports = app;
