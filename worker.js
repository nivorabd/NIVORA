
/**
 * NIVORA ONE — AI Worker
 * Gemini primary + OpenAI fallback
 * Required Cloudflare Secrets:
 *   GEMINI_API_KEY
 *   OPENAI_API_KEY
 */

const GEMINI_MODEL = "gemini-3.8-flash";
const OPENAI_MODEL = "gpt-4.1-mini";

const SYSTEM_INSTRUCTION = `
You are NIVORA AI, a helpful multilingual assistant
inside the NIVORA ONE application.

- Answer accurately, clearly, and politely.
- Support Bengali, English, Hindi, Urdu, and other languages.
- Reply in the language used by the user.
- Help with education, writing, calculations, business,
  stock, accounting, technology, and everyday questions.
- Never invent live data or claim an action was completed
  when it was not.
- For financial, medical, and religious topics, be careful
  and explain uncertainty when appropriate.
`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function getPrompt(body) {
  if (typeof body.prompt === "string" && body.prompt.trim()) {
    return body.prompt.trim();
  }

  if (Array.isArray(body.contents)) {
    const messages = body.contents
      .filter(item => item && Array.isArray(item.parts))
      .map(item => {
        const role = item.role === "model" ? "Assistant" : "User";
        const text = item.parts
          .map(part => typeof part.text === "string" ? part.text : "")
          .join("\n");
        return text ? `${role}: ${text}` : "";
      })
      .filter(Boolean);

    return messages.join("\n\n");
  }

  return "";
}

function getHistory(body) {
  if (!Array.isArray(body.history)) return [];

  return body.history
    .filter(item =>
      item &&
      ["user", "model", "assistant"].includes(item.role) &&
      typeof item.text === "string"
    )
    .slice(-12)
    .map(item => ({
      role: item.role === "user" ? "user" : "assistant",
      content: item.text.slice(0, 12000)
    }));
}

async function askGemini(prompt, history, apiKey) {
  const contents = [
    ...history.map(item => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content }]
    })),
    { role: "user", parts: [{ text: prompt }] }
  ];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }]
        },
        contents,
        generationConfig: {
          maxOutputTokens: 2048,
          thinkingConfig: {
            thinkingLevel: "low"
          }
        }
      }),
      signal: AbortSignal.timeout(25000)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Gemini API (${response.status}): ` +
      (data.error?.message || "Request failed")
    );
  }

  const answer = (data.candidates?.[0]?.content?.parts || [])
    .map(part => part.text || "")
    .join("")
    .trim();

  if (!answer) throw new Error("Gemini returned an empty answer");

  return answer;
}

async function askOpenAI(prompt, history, apiKey) {
  const messages = [
    { role: "system", content: SYSTEM_INSTRUCTION },
    ...history,
    { role: "user", content: prompt }
  ];

  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        max_completion_tokens: 2048
      }),
      signal: AbortSignal.timeout(25000)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `OpenAI API (${response.status}): ` +
      (data.error?.message || "Request failed")
    );
  }

  const answer = data.choices?.[0]?.message?.content?.trim();

  if (!answer) throw new Error("OpenAI returned an empty answer");

  return answer;
}

async function handleAI(request, env) {
  if (request.method !== "POST") {
    return json({ error: "POST method required" }, 405);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON request" }, 400);
  }

  const prompt = getPrompt(body);

  if (!prompt) {
    return json({ error: "প্রশ্ন লিখে আবার চেষ্টা করুন।" }, 400);
  }

  if (prompt.length > 20000) {
    return json({ error: "প্রশ্নটি অনেক বড়। সংক্ষিপ্ত করুন।" }, 413);
  }

  const history = getHistory(body);
  const errors = [];

  // Try Gemini first.
  if (env.GEMINI_API_KEY) {
    try {
      const answer = await askGemini(
        prompt,
        history,
        env.GEMINI_API_KEY
      );

      return json({
        success: true,
        provider: "Gemini",
        answer
      });
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    errors.push("GEMINI_API_KEY is not configured");
  }

  // If Gemini fails, try OpenAI.
  if (env.OPENAI_API_KEY) {
    try {
      const answer = await askOpenAI(
        prompt,
        history,
        env.OPENAI_API_KEY
      );

      return json({
        success: true,
        provider: "OpenAI",
        answer,
        fallback: true
      });
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    errors.push("OPENAI_API_KEY is not configured");
  }

  // Do not expose secret values.
  return json({
    success: false,
    error: "Gemini ও OpenAI—দুই সংযোগেই সমস্যা হয়েছে।",
    details: errors
  }, 502);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        service: "NIVORA ONE",
        worker: "ready",
        aiEndpoint: "/api/ai/chat",
        geminiConfigured: Boolean(env.GEMINI_API_KEY),
        openaiConfigured: Boolean(env.OPENAI_API_KEY),
        time: new Date().toISOString()
      });
    }

    if (url.pathname === "/api/ai/chat") {
      return handleAI(request, env);
    }

    if (!env.ASSETS) {
      return new Response(
        "NIVORA ONE: ASSETS binding is not configured.",
        { status: 500 }
      );
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);

    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
