
/**
 * NIVORA ONE — Cloudflare AI Worker
 * Endpoint: POST /api/ai/chat
 * Secrets: GEMINI_API_KEY, GROQ_API_KEY, OPENAI_API_KEY
 * Binding: AI (Cloudflare Workers AI)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function errorText(error) {
  return String(error?.message || error || "অজানা ত্রুটি")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[গোপন API Key বাদ দেওয়া হয়েছে]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[গোপন API Key বাদ দেওয়া হয়েছে]")
    .slice(0, 700);
}

async function fetchJSON(url, options, provider) {
  let response;

  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(45000)
    });
  } catch (e) {
    throw new Error(`${provider}: নেটওয়ার্ক/টাইমআউট — ${errorText(e)}`);
  }

  const raw = await response.text();
  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { message: raw.slice(0, 400) };
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error?.type ||
      data?.message ||
      `HTTP ${response.status}`;

    throw new Error(
      `${provider}: HTTP ${response.status} — ${errorText(message)}`
    );
  }

  return data;
}

function getHistory(body) {
  const history = Array.isArray(body.history) ? body.history : [];

  return history
    .filter(m =>
      m &&
      typeof m.text === "string" &&
      ["user", "assistant", "model"].includes(m.role)
    )
    .slice(-12)
    .map(m => ({
      role: m.role === "assistant" || m.role === "model"
        ? "assistant"
        : "user",
      content: m.text.slice(0, 12000)
    }));
}

async function askGemini(env, prompt, history) {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY Secret সেট করা নেই।");
  }

  const contents = [
    ...history.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    })),
    { role: "user", parts: [{ text: prompt }] }
  ];

  const data = await fetchJSON(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096
        }
      })
    },
    "Gemini"
  );

  const answer = (data.candidates?.[0]?.content?.parts || [])
    .map(p => p.text || "")
    .join("\n")
    .trim();

  if (!answer) {
    const reason = data.candidates?.[0]?.finishReason || "অজানা";
    throw new Error(`Gemini উত্তর দেয়নি। Finish reason: ${reason}`);
  }

  return answer;
}

async function askGroq(env, prompt, history) {
  if (!env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY Secret সেট করা নেই।");
  }

  const messages = [
    {
      role: "system",
      content: "You are NIVORA AI. Give accurate, helpful answers in the user's language."
    },
    ...history,
    { role: "user", content: prompt }
  ];

  const data = await fetchJSON(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages,
        temperature: 0.7,
        max_tokens: 4096
      })
    },
    "Groq"
  );

  const answer = data.choices?.[0]?.message?.content;

  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error("Groq কোনো লেখা উত্তর দেয়নি।");
  }

  return answer.trim();
}

async function askOpenAI(env, prompt, history) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY Secret সেট করা নেই।");
  }

  const data = await fetchJSON(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are NIVORA AI. Give accurate, helpful answers in the user's language."
          },
          ...history,
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 4096
      })
    },
    "OpenAI"
  );

  const answer = data.choices?.[0]?.message?.content;

  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error("OpenAI কোনো লেখা উত্তর দেয়নি।");
  }

  return answer.trim();
}

async function askWorkersAI(env, prompt, history) {
  if (!env.AI || typeof env.AI.run !== "function") {
    throw new Error("Cloudflare Workers AI binding 'AI' পাওয়া যায়নি।");
  }

  const messages = [
    {
      role: "system",
      content: "You are NIVORA AI. Answer accurately and use the user's language."
    },
    ...history,
    { role: "user", content: prompt }
  ];

  const result = await env.AI.run(
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    { messages, max_tokens: 2048 }
  );

  const answer = result?.response || result?.result?.response;

  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error(
      "Workers AI থেকে উত্তর আসেনি। মডেল উপলভ্যতা, Binding ও Account quota যাচাই করুন।"
    );
  }

  return answer.trim();
}

async function handleChat(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      ok: false,
      error: "অনুরোধের JSON পড়া যায়নি।",
      code: "INVALID_JSON"
    }, 400);
  }

  const prompt = String(body.prompt || body.message || "").trim();

  if (!prompt) {
    return json({
      ok: false,
      error: "আপনার প্রশ্ন খালি। আগে প্রশ্ন লিখুন।",
      code: "EMPTY_PROMPT"
    }, 400);
  }

  if (prompt.length > 30000) {
    return json({
      ok: false,
      error: "প্রশ্নটি অনেক বড়। অনুগ্রহ করে ছোট করে পাঠান।",
      code: "PROMPT_TOO_LONG"
    }, 413);
  }

  const history = getHistory(body);
  const providers = [
    ["Gemini", () => askGemini(env, prompt, history)],
    ["Groq", () => askGroq(env, prompt, history)],
    ["OpenAI", () => askOpenAI(env, prompt, history)],
    ["Cloudflare Workers AI", () => askWorkersAI(env, prompt, history)]
  ];

  const diagnostics = [];

  for (const [provider, run] of providers) {
    try {
      const answer = await run();

      return json({
        ok: true,
        answer,
        provider,
        fallbackUsed: diagnostics.length > 0,
        diagnostics: diagnostics.map(d => ({
          provider: d.provider,
          error: d.error
        }))
      });
    } catch (e) {
      const message = errorText(e);
      diagnostics.push({ provider, error: message });

      console.error("NIVORA provider failed:", provider, message);
    }
  }

  return json({
    ok: false,
    error: "সব AI সংযোগে চেষ্টা করেও উত্তর পাওয়া যায়নি।",
    code: "ALL_PROVIDERS_FAILED",
    message: "নিচে প্রতিটি সংযোগের ত্রুটি দেওয়া হলো।",
    diagnostics
  }, 502);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      if (request.method !== "GET") {
        return json({ ok: false, error: "GET ব্যবহার করুন।" }, 405);
      }

      return json({
        ok: true,
        service: "NIVORA AI Worker",
        status: "running",
        endpoint: "/api/ai/chat",
        secrets: {
          GEMINI_API_KEY: Boolean(env.GEMINI_API_KEY),
          GROQ_API_KEY: Boolean(env.GROQ_API_KEY),
          OPENAI_API_KEY: Boolean(env.OPENAI_API_KEY),
          AI_BINDING: Boolean(env.AI)
        },
        note: "Secret উপস্থিত থাকা মানেই API key বৈধ বা quota সচল—এমন নয়।"
      });
    }

    if (url.pathname === "/api/ai/chat") {
      if (request.method !== "POST") {
        return json({
          ok: false,
          error: "এই endpoint-এ POST অনুরোধ পাঠাতে হবে।",
          code: "METHOD_NOT_ALLOWED"
        }, 405);
      }

      try {
        return await handleChat(request, env);
      } catch (e) {
        console.error("NIVORA Worker unexpected error:", errorText(e));

        return json({
          ok: false,
          error: "Worker-এর ভিতরে অপ্রত্যাশিত ত্রুটি হয়েছে।",
          code: "WORKER_INTERNAL_ERROR",
          message: errorText(e)
        }, 500);
      }
    }

    return json({
      ok: false,
      error: "এই URL পাওয়া যায়নি।",
      code: "NOT_FOUND",
      available: ["/health", "/api/ai/chat"]
    }, 404);
  }
};
