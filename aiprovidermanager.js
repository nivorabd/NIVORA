```js
// ============================================================
// NIVORA ONE — AI Provider Manager
// File: backend/services/aiProviderManager.js
// ============================================================

"use strict";

const { GoogleGenAI } = require("@google/genai");
const OpenAI = require("openai");

const {
  getToolDefinitions,
  executeTool,
  hasTool
} = require("./toolRouter");

// ------------------------------------------------------------
// Environment configuration
// ------------------------------------------------------------

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || "";

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || "";

// ------------------------------------------------------------
// Clients
// ------------------------------------------------------------

const geminiClient = GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: GEMINI_API_KEY
    })
  : null;

const openaiClient = OPENAI_API_KEY
  ? new OpenAI({
      apiKey: OPENAI_API_KEY
    })
  : null;

// ------------------------------------------------------------
// Default models
// ------------------------------------------------------------

const DEFAULT_GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  "gemini-2.5-flash";

const DEFAULT_OPENAI_MODEL =
  process.env.OPENAI_MODEL ||
  "gpt-4.1-mini";

// ------------------------------------------------------------
// Agent settings
// ------------------------------------------------------------

const MAX_TOOL_ROUNDS = 6;

const MAX_TOOL_RESULT_LENGTH = 12000;

// ------------------------------------------------------------
// NIVORA AI system instruction
// ------------------------------------------------------------

const DEFAULT_SYSTEM_INSTRUCTION = `
You are NIVORA AI, the intelligent AI assistant inside NIVORA ONE.

Your job is to provide practical, accurate, useful and clear help
across general questions, education, business, technology,
calculations, productivity, writing, translation, data analysis,
problem solving and NIVORA application features.

LANGUAGE:
1. Understand the user's language.
2. Normally answer in the same language as the user.
3. For Bengali users, use natural, simple, clear চলিত বাংলা.
4. Do not unnecessarily repeat the user's question.

ACCURACY:
1. Never invent information.
2. If information is uncertain, say so clearly.
3. Never claim that an action was completed unless the backend
   actually completed it.
4. Do not expose API keys, passwords, private credentials or
   server environment variables.

TOOL USE:
1. You have access to NIVORA ONE tools.
2. Use a tool when it can provide more accurate information than
   guessing.
3. For mathematical calculations, prefer the calculator tool.
4. For current date/time, use the current-time tool when needed.
5. For NIVORA business questions, use business_summary when the
   user's request requires stored business information.
6. For stock/product questions, use stock_summary or
   product_search when appropriate.
7. For customer questions, use customer_search when appropriate.
8. For ledger questions, use ledger_summary when appropriate.
9. Never pretend that a tool result exists if the tool returned
   no data.

BUSINESS:
When discussing business information, clearly distinguish:
- sales
- purchases
- income
- expenses
- profit
- loss
- stock
- customer dues
- payments

IMPORTANT:
The NIVORA AI backend is responsible for executing tools.
You only request tools when needed and then explain the returned
result clearly to the user.

PROFESSIONAL LIMITS:
For medical, legal or financial matters, provide useful general
information while clearly indicating important limitations where
professional advice is required.

You are NIVORA AI, not a fictional assistant and not a demo.
Do not fabricate successful database operations, calculations,
payments, messages or business records.
`;

// ------------------------------------------------------------
// Normalize conversation
// ------------------------------------------------------------

function normalizeConversation(conversation) {
  if (!Array.isArray(conversation)) {
    return [];
  }

  return conversation
    .slice(-20)
    .map((item) => {

      if (!item || typeof item !== "object") {
        return null;
      }

      const role =
        item.role === "assistant"
          ? "assistant"
          : item.role === "user"
          ? "user"
          : null;

      const content =
        typeof item.content === "string"
          ? item.content.trim()
          : typeof item.text === "string"
          ? item.text.trim()
          : "";

      if (!role || !content) {
        return null;
      }

      return {
        role,
        content
      };
    })
    .filter(Boolean);
}

// ------------------------------------------------------------
// System instruction
// ------------------------------------------------------------

function getSystemInstruction(systemInstruction) {

  if (
    typeof systemInstruction === "string" &&
    systemInstruction.trim()
  ) {
    return systemInstruction.trim();
  }

  return DEFAULT_SYSTEM_INSTRUCTION;
}

// ------------------------------------------------------------
// Gemini tool declarations
// ------------------------------------------------------------

function getGeminiTools() {

  const definitions =
    getToolDefinitions();

  return [
    {
      functionDeclarations:
        definitions.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters:
            tool.parameters || {
              type: "object",
              properties: {}
            }
        }))
    }
  ];
}

// ------------------------------------------------------------
// Safe tool result
// ------------------------------------------------------------

function serializeToolResult(result) {

  let output;

  try {
    output = JSON.stringify(result);
  } catch (error) {
    output = JSON.stringify({
      success: false,
      error: "Tool returned unserializable data."
    });
  }

  if (
    typeof output !== "string"
  ) {
    output = String(output);
  }

  if (
    output.length > MAX_TOOL_RESULT_LENGTH
  ) {
    output =
      output.slice(
        0,
        MAX_TOOL_RESULT_LENGTH
      ) +
      "\n[Tool result truncated]";
  }

  return output;
}

// ------------------------------------------------------------
// Build Gemini conversation
// ------------------------------------------------------------

function buildGeminiContents({
  message,
  conversation
}) {

  const history =
    normalizeConversation(conversation);

  const contents = [];

  for (const item of history) {

    contents.push({
      role:
        item.role === "assistant"
          ? "model"
          : "user",

      parts: [
        {
          text: item.content
        }
      ]
    });
  }

  contents.push({
    role: "user",

    parts: [
      {
        text: message
      }
    ]
  });

  return contents;
}

// ------------------------------------------------------------
// Execute Gemini tool calls
// ------------------------------------------------------------

async function executeGeminiToolCalls(
  functionCalls
) {

  const results = [];

  for (const call of functionCalls) {

    const name =
      call?.name || "";

    const args =
      call?.args &&
      typeof call.args === "object"
        ? call.args
        : {};

    if (!name || !hasTool(name)) {

      results.push({
        name,
        id: call?.id,
        result: {
          success: false,
          error:
            `Unknown or unavailable NIVORA tool: ${name}`
        }
      });

      continue;
    }

    try {

      const result =
        await executeTool(
          name,
          args
        );

      results.push({
        name,
        id: call?.id,
        result
      });

    } catch (error) {

      console.error(
        `NIVORA tool failed [${name}]:`,
        error?.message || error
      );

      results.push({
        name,
        id: call?.id,
        result: {
          success: false,
          error:
            error?.message ||
            "Tool execution failed."
        }
      });
    }
  }

  return results;
}

// ------------------------------------------------------------
// Gemini Agent / Function Calling
// ------------------------------------------------------------

async function callGemini({
  message,
  systemInstruction,
  conversation,
  model
}) {

  if (!geminiClient) {

    const error = new Error(
      "GEMINI_API_KEY is not configured."
    );

    error.code =
      "GEMINI_KEY_MISSING";

    throw error;
  }

  const selectedModel =
    model &&
    model !== "auto" &&
    model !== "openai"
      ? model
      : DEFAULT_GEMINI_MODEL;

  const instruction =
    getSystemInstruction(
      systemInstruction
    );

  let contents =
    buildGeminiContents({
      message: message.trim(),
      conversation
    });

  const tools =
    getGeminiTools();

  // ----------------------------------------------------------
  // Agent loop
  // ----------------------------------------------------------

  for (
    let round = 0;
    round < MAX_TOOL_ROUNDS;
    round++
  ) {

    const response =
      await geminiClient.models.generateContent({

        model: selectedModel,

        contents,

        config: {

          systemInstruction:
            instruction,

          temperature: 0.7,

          tools
        }
      });

    // --------------------------------------------------------
    // Check for tool calls
    // --------------------------------------------------------

    const functionCalls =
      Array.isArray(
        response?.functionCalls
      )
        ? response.functionCalls
        : [];

    // --------------------------------------------------------
    // No tool call = final answer
    // --------------------------------------------------------

    if (
      functionCalls.length === 0
    ) {

      const text =
        typeof response?.text === "string"
          ? response.text.trim()
          : "";

      if (!text) {

        const error =
          new Error(
            "Gemini returned an empty response."
          );

        error.code =
          "GEMINI_EMPTY_RESPONSE";

        throw error;
      }

      return {
        answer: text,

        provider: "gemini",

        model: selectedModel,

        toolsUsed: []
      };
    }

    // --------------------------------------------------------
    // Execute requested tools
    // --------------------------------------------------------

    const toolResults =
      await executeGeminiToolCalls(
        functionCalls
      );

    // --------------------------------------------------------
    // Add Gemini's function-call response
    // --------------------------------------------------------

    const modelContent =
      response?.candidates?.[0]?.content;

    if (modelContent) {
      contents.push(modelContent);
    }

    // --------------------------------------------------------
    // Add function results
    // --------------------------------------------------------

    contents.push({
      role: "user",

      parts:
        toolResults.map((item) => ({
          functionResponse: {

            name: item.name,

            response: {
              result:
                JSON.parse(
                  serializeToolResult(
                    item.result
                  )
                )
            },

            ...(item.id
              ? { id: item.id }
              : {})
          }
        }))
    });
  }

  // ----------------------------------------------------------
  // Maximum agent rounds reached
  // ----------------------------------------------------------

  const error =
    new Error(
      "NIVORA AI reached the maximum tool-processing limit."
    );

  error.code =
    "AI_TOOL_ROUND_LIMIT";

  error.statusCode = 502;

  throw error;
}

// ------------------------------------------------------------
// OpenAI
// ------------------------------------------------------------

async function callOpenAI({
  message,
  systemInstruction,
  conversation,
  model
}) {

  if (!openaiClient) {

    const error = new Error(
      "OPENAI_API_KEY is not configured."
    );

    error.code =
      "OPENAI_KEY_MISSING";

    throw error;
  }

  const selectedModel =
    model &&
    model !== "auto" &&
    model !== "gemini"
      ? model
      : DEFAULT_OPENAI_MODEL;

  const history =
    normalizeConversation(
      conversation
    );

  const messages = [
    {
      role: "system",
      content:
        getSystemInstruction(
          systemInstruction
        )
    }
  ];

  for (const item of history) {

    messages.push({
      role: item.role,
      content: item.content
    });
  }

  messages.push({
    role: "user",
    content: message.trim()
  });

  const response =
    await openaiClient.chat.completions.create({

      model: selectedModel,

      messages,

      temperature: 0.7
    });

  const text =
    response?.choices?.[0]?.message?.content;

  if (
    !text ||
    !String(text).trim()
  ) {

    const error =
      new Error(
        "OpenAI returned an empty response."
      );

    error.code =
      "OPENAI_EMPTY_RESPONSE";

    throw error;
  }

  return {

    answer:
      String(text).trim(),

    provider: "openai",

    model: selectedModel,

    toolsUsed: []
  };
}

// ------------------------------------------------------------
// Main AI Router
// ------------------------------------------------------------

async function generateAIResponse({

  message,

  systemInstruction,

  provider = "auto",

  model = "auto",

  conversation = [],

  app = "NIVORA ONE",

  mode = "studio-agent"

}) {

  if (
    typeof message !== "string" ||
    !message.trim()
  ) {

    const error =
      new Error(
        "AI message is required."
      );

    error.statusCode = 400;

    throw error;
  }

  const selectedProvider =
    typeof provider === "string"
      ? provider.toLowerCase()
      : "auto";

  const normalizedMessage =
    message.trim();

  // ----------------------------------------------------------
  // Explicit Gemini
  // ----------------------------------------------------------

  if (
    selectedProvider === "gemini"
  ) {

    return await callGemini({

      message:
        normalizedMessage,

      systemInstruction,

      conversation,

      model

    });
  }

  // ----------------------------------------------------------
  // Explicit OpenAI
  // ----------------------------------------------------------

  if (
    selectedProvider === "openai"
  ) {

    return await callOpenAI({

      message:
        normalizedMessage,

      systemInstruction,

      conversation,

      model

    });
  }

  // ----------------------------------------------------------
  // AUTO
  //
  // Gemini = Primary
  // OpenAI = Fallback
  // ----------------------------------------------------------

  let geminiError = null;

  if (geminiClient) {

    try {

      return await callGemini({

        message:
          normalizedMessage,

        systemInstruction,

        conversation,

        model

      });

    } catch (error) {

      geminiError = error;

      console.error(
        "NIVORA Gemini failed:",
        error?.message || error
      );
    }
  }

  // ----------------------------------------------------------
  // OpenAI fallback
  // ----------------------------------------------------------

  if (openaiClient) {

    try {

      return await callOpenAI({

        message:
          normalizedMessage,

        systemInstruction,

        conversation,

        model

      });

    } catch (openaiError) {

      console.error(
        "NIVORA OpenAI fallback failed:",
        openaiError?.message || openaiError
      );

      const error =
        new Error(
          `Both AI providers failed. Gemini: ${
            geminiError?.message ||
            "unavailable"
          } | OpenAI: ${
            openaiError?.message ||
            "unavailable"
          }`
        );

      error.statusCode = 502;

      throw error;
    }
  }

  // ----------------------------------------------------------
  // No provider
  // ----------------------------------------------------------

  const error =
    new Error(
      "No AI provider is configured. Please configure GEMINI_API_KEY or OPENAI_API_KEY."
    );

  error.statusCode = 503;

  throw error;
}

// ------------------------------------------------------------
// Exports
// ------------------------------------------------------------

module.exports = {
  generateAIResponse
};
```
