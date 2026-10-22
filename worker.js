
const SYSTEM_PROMPT = `
You are NIVORA AI, a careful multilingual assistant.
Reply in the user's language whenever possible.
Be helpful, accurate, respectful, and clear.
Never claim that an action succeeded unless it actually did.
If you are uncertain, explain the uncertainty honestly.
`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

async function askGemini(message, history, env) {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const contents = [];

  for (const item of history) {
    if (!item || typeof item.content !== "string") continue;

    const role = item.role === "assistant" ? "model" : "user";

    if (item.role === "system") continue;

    contents.push({
      role,
      parts: [{ text: item.content.slice(0, 12000) }]
    });
  }

  contents.push({
    role: "user",
    parts: [{ text: message.slice(0, 12000) }]
  });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096
        }
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Gemini API error ${response.status}: ${
        data.error?.message || "Request failed"
      }`
    );
  }

  const answer = (data.candidates?.[0]?.content?.parts || [])
    .map(part => part.text || "")
    .join("")
    .trim();

  if (!answer) throw new Error("Gemini returned an empty response");

  return answer;
}

async function askOpenAI(message, history, env) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT }
  ];

  for (const item of history) {
    if (
      !item ||
      typeof item.content !== "string" ||
      !["user", "assistant"].includes(item.role)
    ) continue;

    messages.push({
      role: item.role,
      content: item.content.slice(0, 12000)
    });
  }

  messages.push({
    role: "user",
    content: message.slice(0, 12000)
  });

  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-4.1-mini",
        messages,
        temperature: 0.7,
        max_tokens: 4096
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `OpenAI API error ${response.status}: ${
        data.error?.message || "Request failed"
      }`
    );
  }

  const answer = data.choices?.[0]?.message?.content?.trim();

  if (!answer) throw new Error("OpenAI returned an empty response");

  return answer;
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

    if (url.pathname === "/" && request.method === "GET") {
      return json({
        service: "NIVORA AI",
        status: "online",
        endpoint: "/api/ai/chat"
      });
    }

    if (url.pathname === "/api/ai/chat" && request.method === "GET") {
      return json({
        service: "NIVORA AI",
        status: "online",
        method: "POST"
      });
    }

    if (url.pathname !== "/api/ai/chat") {
      return json({ error: "Endpoint not found" }, 404);
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON request" }, 400);
    }

    const message =
      typeof body.message === "string"
        ? body.message.trim()
        : typeof body.prompt === "string"
          ? body.prompt.trim()
          : "";

    if (!message) {
      return json({ error: "Please provide a message" }, 400);
    }

    if (message.length > 12000) {
      return json({ error: "Message is too long" }, 413);
    }

    const history = Array.isArray(body.history)
      ? body.history.slice(-20)
      : Array.isArray(body.messages)
        ? body.messages.slice(-20)
        : [];

    let geminiError = "";

    try {
      const answer = await askGemini(message, history, env);

      return json({
        success: true,
        answer,
        provider: "gemini"
      });
    } catch (error) {
      geminiError = error.message || "Gemini request failed";
    }

    try {
      const answer = await askOpenAI(message, history, env);

      return json({
        success: true,
        answer,
        provider: "openai",
        fallback: true
      });
    } catch (error) {
      return json({
        success: false,
        error: "AI service is temporarily unavailable.",
        details: {
          gemini: geminiError,
          openai: error.message || "OpenAI request failed"
        }
      }, 502);
    }
  }
};
