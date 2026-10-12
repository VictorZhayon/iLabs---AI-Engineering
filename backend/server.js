const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize Google Gen AI
const geminiApiKey = process.env.GEMINI_API_KEY;
let ai = null;
if (geminiApiKey) {
    ai = new GoogleGenAI({ apiKey: geminiApiKey });
} else {
    console.warn("GEMINI_API_KEY is not defined. Code analysis will not function without it.");
}

// Helper: Normalize private key newlines (converts literal \n to real newlines)
function formatPrivateKey(key) {
    if (!key || typeof key !== 'string') return key;
    return key.replace(/\\n/g, '\n');
}

// Helper: Load Firebase Service Account credentials from multiple possible sources
function loadServiceAccount() {
    // 1. Try FIREBASE_SERVICE_ACCOUNT environment variable (common in Vercel)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            let raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
            // Unwrap surrounding quotes if added by shell / secret managers
            if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
                raw = raw.slice(1, -1).trim();
            }
            // Check if base64 encoded
            if (!raw.startsWith('{')) {
                try {
                    const decoded = Buffer.from(raw, 'base64').toString('utf8');
                    if (decoded.trim().startsWith('{')) {
                        raw = decoded.trim();
                    }
                } catch (b64Err) {
                    // Not base64, proceed with raw
                }
            }
            const sa = JSON.parse(raw);
            if (sa.private_key) sa.private_key = formatPrivateKey(sa.private_key);
            if (sa.privateKey) sa.privateKey = formatPrivateKey(sa.privateKey);
            return sa;
        } catch (parseError) {
            console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT environment variable JSON:", parseError.message);
        }
    }

    // 2. Try individual environment variables
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (projectId && clientEmail && privateKey) {
        return {
            projectId,
            clientEmail,
            privateKey: formatPrivateKey(privateKey)
        };
    }

    // 3. Try local file in backend directory during development
    const localPath = path.join(__dirname, 'serviceAccountKey.json');
    if (fs.existsSync(localPath)) {
        try {
            const sa = JSON.parse(fs.readFileSync(localPath, 'utf8'));
            if (sa.project_id && sa.project_id !== "REPLACE_ME") {
                if (sa.private_key) sa.private_key = formatPrivateKey(sa.private_key);
                return sa;
            }
        } catch (fileErr) {
            console.error("Failed to read local serviceAccountKey.json:", fileErr.message);
        }
    }

    return null;
}

// Initialize Firebase Admin
let db = null;
let adminAuth = null;

try {
    if (getApps().length === 0) {
        const serviceAccount = loadServiceAccount();
        if (serviceAccount) {
            initializeApp({
                credential: cert(serviceAccount)
            });
            console.log("Firebase Admin initialized successfully.");
        } else {
            console.warn("Firebase credentials not found or are placeholders. Please configure FIREBASE_SERVICE_ACCOUNT.");
        }
    }

    if (getApps().length > 0) {
        db = getFirestore();
        adminAuth = getAuth();
    }
} catch (error) {
    console.error("Error initializing Firebase Admin:", error);
}

// Authentication Middleware using Firebase Admin ID Token
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Authentication token required' });
    }

    if (!adminAuth || getApps().length === 0) {
        return res.status(500).json({ 
            error: 'Firebase Admin not initialized properly on the server. Please verify FIREBASE_SERVICE_ACCOUNT in your environment variables.' 
        });
    }

    try {
        const decodedToken = await adminAuth.verifyIdToken(token);
        req.user = decodedToken; // contains uid, email, email_verified, name, etc.
        next();
    } catch (error) {
        console.error("Token verification error:", error.message || error);
        return res.status(401).json({ error: 'Invalid or expired token. Please log in again.' });
    }
};

// --- HEALTH & STATUS ROUTE ---
app.get(['/', '/api', '/api/health', '/health'], (req, res) => {
    res.json({
        status: 'healthy',
        service: 'CodeSense AI Backend',
        firebaseInitialized: Boolean(adminAuth && getApps().length > 0),
        geminiConfigured: Boolean(ai)
    });
});

// --- AUTH / OTP ROUTES ---

// Request 6-digit verification code
app.post(['/api/auth/request-otp', '/auth/request-otp'], authenticateToken, async (req, res) => {
    if (!db) {
        return res.status(500).json({ error: 'Database not initialized' });
    }

    try {
        const uid = req.user.uid;
        const email = req.user.email;
        const name = req.user.name || 'Developer';

        if (!email) {
            return res.status(400).json({ error: 'User does not have an email address associated.' });
        }

        // Rate limiting check: No more than 1 request per minute per user
        const oneMinuteAgo = Date.now() - 60 * 1000;
        const docRef = db.collection('otp_verifications').doc(uid);
        const doc = await docRef.get();

        if (doc.exists) {
            const data = doc.data();
            if (data.createdAt && data.createdAt > oneMinuteAgo) {
                return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
            }
        }

        // Generate cryptographically secure 6-digit OTP
        const otp = crypto.randomInt(100000, 999999).toString();
        
        // Expiration: 10 minutes
        const expiresAt = Date.now() + 10 * 60 * 1000;

        // Save to Firestore with reset attempt counter
        await docRef.set({
            uid,
            email,
            otp,
            attempts: 0,
            expiresAt,
            createdAt: Date.now()
        });

        // Verify EmailJS configuration
        const serviceId = process.env.EMAILJS_SERVICE_ID;
        const templateId = process.env.EMAILJS_TEMPLATE_ID;
        const publicKey = process.env.EMAILJS_PUBLIC_KEY;
        const privateKey = process.env.EMAILJS_PRIVATE_KEY;

        if (!serviceId || !templateId || !publicKey || !privateKey) {
            console.error("Missing EmailJS environment variables (SERVICE_ID, TEMPLATE_ID, PUBLIC_KEY, or PRIVATE_KEY).");
            return res.status(500).json({ error: 'Email service is not configured properly on the server.' });
        }

        // Send via EmailJS REST API with aliases for flexible template configurations
        const emailjsResponse = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service_id: serviceId,
                template_id: templateId,
                user_id: publicKey,
                accessToken: privateKey,
                template_params: {
                    to_email: email,
                    email: email,
                    recipient: email,
                    to_name: name,
                    name: name,
                    otp_code: otp,
                    otp: otp,
                    passcode: otp,
                    code: otp
                }
            })
        });

        if (!emailjsResponse.ok) {
            const errText = await emailjsResponse.text();
            console.error('EmailJS Error:', errText);
            throw new Error(`Failed to send email via EmailJS: ${errText}`);
        }

        res.json({ message: 'Verification code sent successfully.' });

    } catch (error) {
        console.error("Error requesting OTP:", error.message || error);
        res.status(500).json({ error: 'Failed to send verification code. Please try again later.' });
    }
});

// Verify 6-digit code
app.post(['/api/auth/verify-otp', '/auth/verify-otp'], authenticateToken, async (req, res) => {
    if (!db || !adminAuth) {
        return res.status(500).json({ error: 'Database or authentication service not initialized' });
    }

    try {
        const { otp } = req.body;
        const uid = req.user.uid;

        if (!otp) {
            return res.status(400).json({ error: 'Verification code is required' });
        }

        const docRef = db.collection('otp_verifications').doc(uid);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(400).json({ error: 'No verification request found for this account. Please request a new code.' });
        }

        const data = doc.data();

        if (Date.now() > data.expiresAt) {
            await docRef.delete();
            return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
        }

        // Track and rate-limit failed attempts to prevent brute force
        const attempts = (data.attempts || 0) + 1;
        if (attempts > 5) {
            await docRef.delete();
            return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new code.' });
        }

        if (data.otp !== String(otp).trim()) {
            await docRef.update({ attempts });
            return res.status(400).json({ error: 'Invalid verification code. Please check and try again.' });
        }

        // OTP is valid: mark user email as verified in Firebase Auth
        await adminAuth.updateUser(uid, {
            emailVerified: true
        });

        // Delete used OTP document
        await docRef.delete();

        res.json({ message: 'Email verified successfully.' });

    } catch (error) {
        console.error("Error verifying OTP:", error.message || error);
        res.status(500).json({ error: 'Failed to verify code' });
    }
});

// --- CODE ANALYSIS ROUTE ---

app.post(['/api/analyze', '/analyze'], authenticateToken, async (req, res) => {
    // Ensure email is verified before allowing analysis
    if (!req.user.email_verified) {
        return res.status(403).json({ error: 'Email must be verified to use this feature.' });
    }

    if (!ai) {
        return res.status(500).json({ error: 'Gemini AI is not configured on the server. Please check GEMINI_API_KEY.' });
    }

    try {
        const { code } = req.body;

        if (!code || typeof code !== 'string' || !code.trim()) {
            return res.status(400).json({ error: 'Code snippet is required' });
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

        const textResponse = response.text || '';
        
        let result;
        try {
            // Locate JSON bounds in case markdown or surrounding text is present
            const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
            const jsonStringToParse = jsonMatch ? jsonMatch[0] : textResponse.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            result = JSON.parse(jsonStringToParse);
        } catch (parseError) {
            console.warn("AI output was not strict JSON. Falling back to structured response:", textResponse);
            result = {
                explanation: textResponse.trim() || 'Analysis completed.',
                issues: [],
                suggestions: []
            };
        }

        // Store analysis in history
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
        const errMsg = error.message && error.message.includes('API_KEY')
            ? 'Gemini API key is invalid or not authorized.'
            : 'Failed to analyze code. Please try again.';
        res.status(500).json({ error: errMsg });
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
    return 'code';
}

// --- HISTORY ROUTES ---

// Get all history for the authenticated user (newest first)
app.get(['/api/history', '/history'], authenticateToken, async (req, res) => {
    if (!db) return res.json([]);
    
    try {
        const snapshot = await db.collection('history')
            .where('userId', '==', req.user.uid)
            .get();
            
        const userHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // In-memory sort avoids composite index requirement
        userHistory.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(userHistory.slice(0, 50));
    } catch (error) {
        console.error("Error fetching history:", error);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

// Get a single history entry by ID
app.get(['/api/history/:id', '/history/:id'], authenticateToken, async (req, res) => {
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
app.delete(['/api/history/:id', '/history/:id'], authenticateToken, async (req, res) => {
    if (!db) return res.status(404).json({ error: 'Database not initialized' });
    
    try {
        const docRef = db.collection('history').doc(req.params.id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data().userId !== req.user.uid) {
            return res.status(404).json({ error: 'History entry not found' });
        }
        await docRef.delete();
        res.json({ message: 'History entry deleted successfully' });
    } catch (error) {
        console.error("Error deleting history entry:", error);
        res.status(500).json({ error: 'Failed to delete history entry' });
    }
});

// Start server when executed directly (e.g. node server.js or npm start)
if (require.main === module) {
    app.listen(port, () => {
        console.log(`Backend server running on http://localhost:${port}`);
    });
}

module.exports = app;
