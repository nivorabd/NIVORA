// ============================================================
// NIVORA ONE — Secure AI Backend Server
// File: backend/server.js
// ============================================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");

const {
  generateAIResponse
} = require("./services/aiProviderManager");

const app = express();

const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// Middleware
// ------------------------------------------------------------

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.use(
  express.json({
    limit: "2mb"
  })
);

// ------------------------------------------------------------
// Basic health check
// ------------------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    success: true,
    app: "NIVORA ONE AI Backend",
    status: "online",
    endpoint: "/api/ai"
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    service: "NIVORA ONE AI Backend"
  });
});

// ------------------------------------------------------------
// AI API
// ------------------------------------------------------------

app.post("/api/ai", async (req, res) => {
  try {
    const {
      message,
      prompt,
      systemInstruction,
      provider = "auto",
      model = "auto",
      conversation = [],
      app = "NIVORA ONE",
      mode = "studio-agent"
    } = req.body || {};

    // --------------------------------------------------------
    // Accept either "message" or "prompt"
    // --------------------------------------------------------

    const userMessage =
      typeof message === "string" && message.trim()
        ? message.trim()
        : typeof prompt === "string" && prompt.trim()
        ? prompt.trim()
        : "";

    if (!userMessage) {
      return res.status(400).json({
        success: false,
        error: "AI message is required."
      });
    }

    // --------------------------------------------------------
    // Limit conversation size for safety/performance
    // --------------------------------------------------------

    const safeConversation = Array.isArray(conversation)
      ? conversation.slice(-20)
      : [];

    // --------------------------------------------------------
    // AI request
    // --------------------------------------------------------

    const result = await generateAIResponse({
      message: userMessage,
      systemInstruction:
        typeof systemInstruction === "string"
          ? systemInstruction
          : "",
      provider,
      model,
      conversation: safeConversation,
      app,
      mode
    });

    // --------------------------------------------------------
    // Normalize provider response
    // --------------------------------------------------------

    const answer =
      result?.answer ??
      result?.response ??
      result?.text ??
      result?.output ??
      result?.content ??
      "";

    if (!answer || !String(answer).trim()) {
      return res.status(502).json({
        success: false,
        error: "AI provider returned an empty response."
      });
    }

    return res.status(200).json({
      success: true,
      answer: String(answer),
      provider: result?.provider || "unknown",
      model: result?.model || model || "auto"
    });
  } catch (error) {
    console.error("NIVORA AI ERROR:", error);

    const statusCode =
      Number.isInteger(error?.statusCode) &&
      error.statusCode >= 400 &&
      error.statusCode <= 599
        ? error.statusCode
        : 500;

    return res.status(statusCode).json({
      success: false,
      error:
        error?.message ||
        "NIVORA AI server could not process the request."
    });
  }
});

// ------------------------------------------------------------
// 404 handler
// ------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "NIVORA backend route not found."
  });
});

// ------------------------------------------------------------
// Global error handler
// ------------------------------------------------------------

app.use((error, req, res, next) => {
  console.error("GLOBAL SERVER ERROR:", error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    success: false,
    error: "Internal NIVORA server error."
  });
});

// ------------------------------------------------------------
// Start server
// ------------------------------------------------------------

app.listen(PORT, () => {
  console.log("==============================================");
  console.log("NIVORA ONE AI Backend");
  console.log("==============================================");
  console.log(`Server running on port: ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`AI API: http://localhost:${PORT}/api/ai`);
  console.log("==============================================");
});