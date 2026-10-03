// ============================================================
// NIVORA ONE — Netlify AI Function
// File: netlify/functions/ai.js
// ============================================================

"use strict";

const {
  generateAIResponse
} = require("../../backend/services/aiProviderManager");

exports.handler = async function (event) {
  // ----------------------------------------------------------
  // CORS
  // ----------------------------------------------------------

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  // ----------------------------------------------------------
  // OPTIONS / CORS preflight
  // ----------------------------------------------------------

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers,
      body: ""
    };
  }

  // ----------------------------------------------------------
  // Only POST is allowed
  // ----------------------------------------------------------

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        error: "Only POST requests are allowed."
      })
    };
  }

  // ----------------------------------------------------------
  // Parse request body
  // ----------------------------------------------------------

  let body = {};

  try {
    body = event.body
      ? JSON.parse(event.body)
      : {};
  } catch (error) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        success: false,
        error: "Invalid JSON request body."
      })
    };
  }

  // ----------------------------------------------------------
  // Extract request data
  // ----------------------------------------------------------

  const {
    message,
    prompt,
    systemInstruction,
    provider = "auto",
    model = "auto",
    conversation = [],
    app = "NIVORA ONE",
    mode = "studio-agent"
  } = body;

  // ----------------------------------------------------------
  // Accept message OR prompt
  // ----------------------------------------------------------

  const userMessage =
    typeof message === "string" && message.trim()
      ? message.trim()
      : typeof prompt === "string" && prompt.trim()
      ? prompt.trim()
      : "";

  if (!userMessage) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        success: false,
        error: "AI message is required."
      })
    };
  }

  // ----------------------------------------------------------
  // Limit conversation
  // ----------------------------------------------------------

  const safeConversation =
    Array.isArray(conversation)
      ? conversation.slice(-20)
      : [];

  // ----------------------------------------------------------
  // Generate AI response
  // ----------------------------------------------------------

  try {
    const result = await generateAIResponse({
      message: userMessage,

      systemInstruction:
        typeof systemInstruction === "string"
          ? systemInstruction
          : "",

      provider,
      model,

      conversation:
        safeConversation,

      app,
      mode
    });

    const answer =
      result?.answer ??
      result?.response ??
      result?.text ??
      result?.output ??
      result?.content ??
      "";

    if (
      !answer ||
      !String(answer).trim()
    ) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          success: false,
          error:
            "AI provider returned an empty response."
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        answer: String(answer),

        provider:
          result?.provider || "unknown",

        model:
          result?.model ||
          model ||
          "auto"
      })
    };

  } catch (error) {

    console.error(
      "NIVORA NETLIFY AI ERROR:",
      error
    );

    return {
      statusCode:
        Number.isInteger(error?.statusCode)
          ? error.statusCode
          : 500,

      headers,

      body: JSON.stringify({
        success: false,

        error:
          error?.message ||
          "NIVORA AI could not process the request."
      })
    };
  }
};