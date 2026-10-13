
/**
 * NIVORA ONE — Cloudflare Worker
 * Static Assets + Secure Gemini AI API
 *
 * Required Secret:
 *   GEMINI_API_KEY
 *
 * Optional Variable:
 *   GEMINI_MODEL = gemini-2.5-flash
 */

const DEFAULT_MODEL = "gemini-2.5-flash";
const MAX_REQUEST_BYTES = 18 * 1024 * 1024;

const SYSTEM_INSTRUCTION = `
You are NIVORA ONE, an advanced multilingual multimodal AI assistant.

LANGUAGES:
- Understand Bengali, English, Banglish and other supported languages.
- Reply naturally in the user's preferred language.

CONTEXT AND INTENT:
- Consider the user's words, phrasing, available tone,
  conversation context and stated goals.
- Separate observed facts from possible interpretations.
- Ask clarifying questions when intent is ambiguous.

IMAGE, VIDEO AND AUDIO:
- Analyze only media actually supplied and supported by the model.
- Describe visible facial expressions, gaze direction, posture,
  gestures, movement and relevant scene details when observable.
- Analyze vocal tone only when the supplied audio and model support it.
- Present emotional or behavioral interpretations as possibilities,
  never as certain knowledge of someone's thoughts.
- Never claim to read minds.
- Do not determine honesty, personality, beliefs, health or intentions
  as facts from appearance, gaze, voice or gestures alone.
- Mention uncertainty and alternative explanations.
- Do not identify a person from their face.

RESPONSE FORMAT:
When useful, provide:
1. Observable evidence.
2. Possible interpretations.
3. Confidence and limitations.
4. A respectful follow-up question or practical next step.

BUSINESS AND APP DATA:
- Use only records and context actually supplied.
- Never invent products, stock, sales, purchases, customers,
  financial records or other business information.
- Clearly say when information is unavailable.

Be helpful, respectful, privacy-conscious and accurate.
`;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function addSecurityHeaders(response) {
  const headers = new Headers(response.headers);

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Cache-Control", "no-store");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function handleAI(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({
      error: "এই API-তে POST request পাঠাতে হবে।"
    }, 405);
  }

  if (!env.GEMINI_API_KEY) {
    return jsonResponse({
      error: "Cloudflare Secret GEMINI_API_KEY সেট করা নেই।"
    }, 500);
  }

  const contentLength = Number(
    request.headers.get("Content-Length") || 0
  );

  if (contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse({
      error: "অনুরোধটি অনেক বড়। ছোট ফাইল দিয়ে আবার চেষ্টা করুন।"
    }, 413);
  }

  let body;

  try {
    const rawBody = await request.text();
    const byteLength = new TextEncoder().encode(rawBody).length;

    if (byteLength > MAX_REQUEST_BYTES) {
      return jsonResponse({
        error: "অনুরোধের আকার 18 MB সীমা অতিক্রম করেছে।"
      }, 413);
    }

    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({
      error: "অনুরোধের JSON সঠিক নয়।"
    }, 400);
  }

  let contents = body.contents;

  // Support the earlier NIVORA request format too.
  if (!Array.isArray(contents)) {
    const prompt = String(body.prompt || "").trim();

    if (!prompt) {
      return jsonResponse({
        error: "প্রশ্ন বা মেসেজ পাওয়া যায়নি।"
      }, 400);
    }

    const context = body.context
      ? "\n\nপ্রদত্ত অ্যাপের তথ্য:\n" + String(body.context)
      : "";

    const appInfo = body.appInfo
      ? "\n\nঅ্যাপের প্রাসঙ্গিক তথ্য:\n" + String(body.appInfo)
      : "";

    const history = Array.isArray(body.history)
      ? body.history
          .filter(item =>
            item &&
            ["user", "model"].includes(item.role) &&
            typeof item.text === "string"
          )
          .slice(-12)
          .map(item => ({
            role: item.role,
            parts: [{ text: item.text }]
          }))
      : [];

    contents = [
      ...history,
      {
        role: "user",
        parts: [{
          text: prompt + context + appInfo
        }]
      }
    ];
  }

  if (
    contents.length === 0 ||
    contents.length > 30
  ) {
    return jsonResponse({
      error: "মেসেজের সংখ্যা সঠিক নয়।"
    }, 400);
  }

  for (const item of contents) {
    if (
      !item ||
      !["user", "model"].includes(item.role) ||
      !Array.isArray(item.parts) ||
      item.parts.length === 0
    ) {
      return jsonResponse({
        error: "মেসেজের কাঠামো সঠিক নয়।"
      }, 400);
    }

    for (const part of item.parts) {
      if (!part || typeof part !== "object") {
        return jsonResponse({
          error: "মেসেজের অংশটি সঠিক নয়।"
        }, 400);
      }

      if (
        part.text !== undefined &&
        typeof part.text !== "string"
      ) {
        return jsonResponse({
          error: "টেক্সটের ফরম্যাট সঠিক নয়।"
        }, 400);
      }

      const file = part.inline_data || part.inlineData;

      if (file) {
        if (
          typeof file.data !== "string" ||
          typeof file.mime_type !== "string" &&
          typeof file.mimeType !== "string"
        ) {
          return jsonResponse({
            error: "সংযুক্ত ফাইলের তথ্য সঠিক নয়।"
          }, 400);
        }

        const mimeType = file.mime_type || file.mimeType;

        // Accept common media and PDF MIME types.
        const allowedMime =
          /^(image\/(jpeg|png|webp|heic|heif)|audio\/[a-zA-Z0-9.+-]+|video\/[a-zA-Z0-9.+-]+|application\/pdf)$/i;

        if (!allowedMime.test(mimeType)) {
          return jsonResponse({
            error: "এই ফাইলের ধরন সরাসরি সমর্থিত নয়। ছবি, PDF অথবা সমর্থিত অডিও/ভিডিও ব্যবহার করুন।"
          }, 415);
        }

        // Normalize camelCase input to Gemini's snake_case format.
        if (part.inlineData) {
          part.inline_data = {
            mime_type: mimeType,
            data: file.data
          };
          delete part.inlineData;
        }
      }
    }
  }

  const model = String(
    env.GEMINI_MODEL || DEFAULT_MODEL
  ).trim();

  if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
    return jsonResponse({
      error: "GEMINI_MODEL variable-এর মান সঠিক নয়।"
    }, 500);
  }

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent";

  let upstream;

  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{
            text: SYSTEM_INSTRUCTION
          }]
        },
        contents,
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 4096
        }
      })
    });
  } catch (error) {
    console.error("Gemini connection failed:", error);

    return jsonResponse({
      error: "Gemini সার্ভারে সংযোগ করা যায়নি। ইন্টারনেট বা সার্ভারের অবস্থা পরীক্ষা করুন।"
    }, 502);
  }

  let result;

  try {
    result = await upstream.json();
  } catch {
    return jsonResponse({
      error: "Gemini থেকে সঠিক JSON উত্তর পাওয়া যায়নি।"
    }, 502);
  }

  if (!upstream.ok) {
    const message =
      result?.error?.message ||
      "Gemini API অনুরোধ গ্রহণ করেনি।";

    console.error(
      "Gemini API error status:",
      upstream.status
    );

    return jsonResponse({
      error: "Gemini API ত্রুটি: " + message,
      upstreamStatus: upstream.status
    }, upstream.status);
  }

  return jsonResponse(result, 200);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/ai/chat") {
        return addSecurityHeaders(
          await handleAI(request, env)
        );
      }

      if (url.pathname === "/api/health") {
        return addSecurityHeaders(
          jsonResponse({
            service: "NIVORA ONE",
            worker: "ready",
            aiEndpoint: "/api/ai/chat",
            time: new Date().toISOString()
          })
        );
      }

      if (!env.ASSETS) {
        return addSecurityHeaders(
          new Response(
            "NIVORA ONE: ASSETS binding is not configured.",
            {
              status: 500,
              headers: {
                "Content-Type": "text/plain; charset=UTF-8"
              }
            }
          )
        );
      }

      const response = await env.ASSETS.fetch(request);

      return addSecurityHeaders(response);
    } catch (error) {
      console.error("NIVORA ONE Worker error:", error);

      return addSecurityHeaders(
        new Response(
          "NIVORA ONE service error.",
          {
            status: 500,
            headers: {
              "Content-Type": "text/plain; charset=UTF-8"
            }
          }
        )
      );
    }
  }
};
