# CodeSense AI 🚀

An intelligent, AI-powered code analysis application built with **Node.js** and **Gemini API**. Simply paste your code, and CodeSense will instantly generate a clear explanation, identify potential issues or bugs, and offer actionable suggestions for improvement.

The application features a lightning-fast lightweight backend and a stunning, premium dark-mode interface utilizing glassmorphism and modern web aesthetics.

## ✨ Features

- **Code Explanation**: Breaks down complex logic into human-readable explanations.
- **Bug & Issue Detection**: Scans for anti-patterns, performance bottlenecks, and potential runtime errors.
- **Actionable Suggestions**: Provides best practices and refactoring tips.
- **Beautiful UI/UX**: Custom-designed with sleek micro-animations, glowing effects, and a highly responsive layout.
- **Separation of Concerns**: Clean architecture separating the Vite frontend from the Express backend.

## 🛠️ Tech Stack

- **AI Layer**: [Google GenAI SDK](https://github.com/google/genai-js) (Gemini 2.5 Pro)
- **Backend**: Node.js, Express.js
- **Frontend**: Vite (Vanilla JavaScript, HTML5, CSS3)
- **Styling**: Custom CSS (Dark mode, glassmorphism)

---

## 🚀 Getting Started

Follow these steps to set up the project locally. 

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- A Google Gemini API Key

### 1. Set up the Backend

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Add your API Key:
   Open the `backend/.env` file (or create one) and add your Gemini API Key:
   ```env
   PORT=3000
   GEMINI_API_KEY=your_gemini_api_key_here
   ```
4. Start the backend server:
   ```bash
   npm run start
   ```
   *The server will run on `http://localhost:3000`.*

### 2. Set up the Frontend

1. Open a new terminal instance and navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Vite development server:
   ```bash
   npm run dev
   ```
4. Open your browser and navigate to the Local URL provided by Vite (usually `http://localhost:5173/`).

---

## 🎨 Design Philosophy

CodeSense AI bypasses heavy frontend frameworks to demonstrate the power of **Vanilla CSS** and native DOM APIs, achieving maximum flexibility. It implements a rich aesthetic—featuring tailored gradients, glowing orbs, and seamless transitions—to ensure the interface feels incredibly modern and premium.

## 📝 License

This project is licensed under the MIT License.
