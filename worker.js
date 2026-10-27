const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const DEFAULT_IMAGE_MODEL = 'gemini-nano-banana-2.1';
const DEFAULT_TTS_MODEL = 'gemini-3.8-flash-tts';

const SYSTEM_INSTRUCTION =
  'You are NIVORA AI inside NIVORA ONE. Answer in the user language, preferably Bengali when they write Bengali. Help with questions, writing, translation, coding, debugging, planning and analysis. Do not claim an action or integration happened unless it did. Treat forecasts as estimates, not guarantees.';

const json = (data, status = 200, request = null) => {
  const origin = request?.headers?.get('Origin');
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization'
  };
  if (origin) headers['access-control-allow-origin'] = origin;
  return new Response(JSON.stringify(data), { status, headers });
};

const str = (value, max = 30000) =>
  typeof value === 'string' ? value.slice(0, max) : '';

async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 7000000) throw new Error('Request too large.');
  const body = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Invalid JSON object.');
  }
  return body;
}

async function providerJson(response) {
  return response.json().catch(() => ({}));
}

function geminiModel(env, requested = '') {
  const requestedModel = str(requested, 100).trim();
  if (/^gemini-[\w.-]+$/.test(requestedModel) && !requestedModel.startsWith('gemini-2.5-')) {
    return requestedModel;
  }
  const configured = str(env.GEMINI_MODEL, 100).trim();
  if (!configured || configured.startsWith('gemini-2.5-') || !/^gemini-[\w.-]+$/.test(configured)) {
    return DEFAULT_GEMINI_MODEL;
  }
  return configured;
}

function outputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const step of Array.isArray(data?.steps) ? data.steps : []) {
    if (step?.type !== 'model_output' && step?.type !== 'output_text') continue;
    for (const item of Array.isArray(step.content) ? step.content : []) {
      if (item?.type === 'text' && typeof item.text === 'string') chunks.push(item.text);
    }
  }
  if (chunks.length) return chunks.join('\n').trim();
  const candidates = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(candidates)) return candidates.map(x => x?.text || '').join('\n').trim();
  return '';
}

function outputImage(data) {
  if (data?.output_image?.data) return data.output_image;
  for (const step of Array.isArray(data?.steps) ? data.steps : []) {
    for (const item of Array.isArray(step?.content) ? step.content : []) {
      if (item?.type === 'image' && item?.data) return item;
    }
  }
  return null;
}

function outputAudio(data) {
  if (data?.output_audio?.data) return data.output_audio;
  for (const step of Array.isArray(data?.steps) ? data.steps : []) {
    for (const item of Array.isArray(step?.content) ? step.content : []) {
      if (item?.type === 'audio' && item?.data) return item;
    }
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(request.method)) {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin') || url.origin;
      return new Response(null, { status: 204, headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'Content-Type, Authorization',
        'access-control-max-age': '86400'
      }});
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({
        status: 'online',
        aiConfigured: !!(env.GEMINI_API_KEY || env.OPENAI_API_KEY || env.GROQ_API_KEY),
        imageConfigured: !!(env.GEMINI_API_KEY || env.OPENAI_API_KEY),
        videoConfigured: !!env.RUNWAY_API_KEY,
        ttsConfigured: !!env.GEMINI_API_KEY,
        promptConfigured: !!env.GEMINI_API_KEY,
        providers: {
          gemini: !!env.GEMINI_API_KEY,
          openai: !!env.OPENAI_API_KEY,
          groq: !!env.GROQ_API_KEY,
          runway: !!env.RUNWAY_API_KEY
        },
        models: {
          gemini: geminiModel(env),
          image: env.GEMINI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
          tts: env.GEMINI_TTS_MODEL || DEFAULT_TTS_MODEL,
          video: env.RUNWAY_VIDEO_MODEL || 'gen4.5'
        }
      }, 200, request);
    }

    if (url.pathname === '/api/ai' && request.method === 'POST') {
      let body;
      try { body = await readJson(request); }
      catch (error) {
        return json({ error: error.message === 'Request too large.' ? error.message : 'Invalid JSON request.' }, 400, request);
      }

      const message = str(body.message).trim();
      const attachmentText = str(body.attachmentText, 15000);
      const imageData = str(body.imageData, 5500000);
      const mime = str(body.imageMimeType, 100);
      const requested = str(body.model, 100);
      if (!message && !attachmentText && !imageData) return json({ error: 'Message or supported attachment required.' }, 400, request);

      try {
        const openai = requested.startsWith('gpt-') || requested === 'openai';
        const groq = requested.startsWith('groq-') || requested === 'groq';
        let reply = '';

        if (openai || groq) {
          const key = openai ? env.OPENAI_API_KEY : env.GROQ_API_KEY;
          if (!key) return json({ error: `${openai ? 'OPENAI_API_KEY' : 'GROQ_API_KEY'} Secret is not configured in Cloudflare.` }, 503, request);
          if (imageData) return json({ error: 'এই Worker-এ OpenAI/Groq-এর ছবি ইনপুট চালু নেই। ছবি বোঝার জন্য Gemini 3.8 Flash নির্বাচন করুন।' }, 400, request);

          const model = openai
            ? (requested.startsWith('gpt-') ? requested : 'gpt-4o-mini')
            : (requested.startsWith('groq-') ? requested.slice(5) : 'llama-3.3-70b-versatile');
          const endpoint = openai
            ? 'https://api.openai.com/v1/chat/completions'
            : 'https://api.groq.com/openai/v1/chat/completions';
          const messages = [{ role: 'system', content: SYSTEM_INSTRUCTION }];
          if (Array.isArray(body.history)) {
            for (const item of body.history.slice(-12)) {
              if (['user', 'assistant'].includes(item?.role) && typeof item.content === 'string') {
                messages.push({ role: item.role, content: item.content.slice(0, 12000) });
              }
            }
          }
          messages.push({ role: 'user', content: message + (attachmentText ? `\n\nAttached text (${str(body.attachmentName, 120)}):\n${attachmentText}` : '') });
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: 4096 })
          });
          const data = await providerJson(response);
          if (!response.ok) return json({ error: data?.error?.message || `AI provider HTTP ${response.status}` }, response.status === 429 ? 429 : 502, request);
          reply = data?.choices?.[0]?.message?.content || '';
        } else {
          if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY Secret is not configured in Cloudflare.' }, 503, request);
          const model = geminiModel(env, requested);
          const history = Array.isArray(body.history) ? body.history.slice(-8).map(item => `${item?.role === 'assistant' ? 'Assistant' : 'User'}: ${str(item?.content, 4000)}`).join('\n') : '';
          const prompt = `${SYSTEM_INSTRUCTION}\n\nConversation context:\n${history}\n\nUser request:\n${message}${attachmentText ? `\n\nAttached text (${str(body.attachmentName, 120)}):\n${attachmentText}` : ''}`;
          const input = [{ type: 'text', text: prompt }];
          if (imageData) {
            if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) return json({ error: 'Unsupported image type. Use PNG, JPEG, WEBP or GIF.' }, 400, request);
            input.push({ type: 'image', mime_type: mime, data: imageData });
          }
          const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
            method: 'POST',
            headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, input })
          });
          const data = await providerJson(response);
          if (!response.ok) return json({ error: data?.error?.message || `Gemini Interactions API HTTP ${response.status}. Check model access, key, quota and billing.` }, response.status === 429 ? 429 : 502, request);
          reply = outputText(data);
        }
        return reply ? json({ reply }, 200, request) : json({ error: 'AI returned an empty response.' }, 502, request);
      } catch (error) {
        return json({ error: `AI request failed: ${error?.message || 'Unknown error'}` }, 502, request);
      }
    }

    if (url.pathname === '/api/prompt' && request.method === 'POST') {
      if (!env.GEMINI_API_KEY) return json({ error: 'প্রম্পট উন্নত করতে GEMINI_API_KEY Secret প্রয়োজন।' }, 503, request);
      let body;
      try { body = await readJson(request); }
      catch { return json({ error: 'Invalid JSON request.' }, 400, request); }
      const prompt = str(body.prompt, 3000).trim();
      if (!prompt) return json({ error: 'Prompt is required.' }, 400, request);
      const language = str(body.language, 20) || 'bn';
      const instruction = `You are a professional image/video prompt engineer. Rewrite the user's idea as one detailed production-ready prompt in the same language as the user's idea (language hint: ${language}). Preserve the user's intent. Include subject, setting, composition, lighting, camera/lens or motion, visual style, mood, and quality details. For video, include shot progression and movement. Do not add claims or brand logos that the user did not request. Return only the final prompt, no markdown, no explanation. User idea: ${prompt}`;
      try {
        const model = geminiModel(env);
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
          method: 'POST',
          headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, input: instruction })
        });
        const data = await providerJson(response);
        if (!response.ok) return json({ error: data?.error?.message || `Prompt API HTTP ${response.status}` }, response.status === 429 ? 429 : 502, request);
        const result = outputText(data);
        return result ? json({ prompt: result, provider: 'gemini', model }, 200, request) : json({ error: 'AI returned an empty prompt.' }, 502, request);
      } catch (error) {
        return json({ error: `Prompt request failed: ${error?.message || 'Unknown error'}` }, 502, request);
      }
    }

    if (url.pathname === '/api/image' && request.method === 'POST') {
      let body;
      try { body = await readJson(request); }
      catch { return json({ error: 'Invalid JSON or request too large.' }, 400, request); }
      const prompt = str(body.prompt, 4000).trim();
      if (!prompt) return json({ error: 'Image prompt is required.' }, 400, request);
      try {
        if (env.GEMINI_API_KEY) {
          const model = env.GEMINI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
          const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
            method: 'POST',
            headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, input: [{ type: 'text', text: prompt }] })
          });
          const data = await providerJson(response);
          if (response.ok) {
            const image = outputImage(data);
            if (image?.data) return json({ imageBase64: image.data, mimeType: image.mime_type || 'image/png', provider: 'gemini', model }, 200, request);
            if (!env.OPENAI_API_KEY) return json({ error: 'Gemini returned no image data. Check image model access, quota and billing.' }, 502, request);
          } else if (!env.OPENAI_API_KEY) {
            return json({ error: data?.error?.message || `Gemini image API HTTP ${response.status}` }, response.status === 429 ? 429 : 502, request);
          }
        }
        if (!env.OPENAI_API_KEY) return json({ error: 'ছবি তৈরির জন্য GEMINI_API_KEY অথবা OPENAI_API_KEY Cloudflare Secret প্রয়োজন।' }, 503, request);
        const response = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: env.OPENAI_IMAGE_MODEL || 'gpt-image-1', prompt, size: '1024x1024' })
        });
        const data = await providerJson(response);
        if (!response.ok) return json({ error: data?.error?.message || `OpenAI image HTTP ${response.status}` }, response.status === 429 ? 429 : 502, request);
        const item = data?.data?.[0];
        if (item?.b64_json) return json({ imageBase64: item.b64_json, mimeType: 'image/png', provider: 'openai' }, 200, request);
        if (item?.url) return json({ imageUrl: item.url, mimeType: 'image/png', provider: 'openai' }, 200, request);
        return json({ error: 'Image provider returned no image.' }, 502, request);
      } catch (error) {
        return json({ error: `Image request failed: ${error?.message || 'Unknown error'}` }, 502, request);
      }
    }

    if (url.pathname === '/api/tts' && request.method === 'POST') {
      if (!env.GEMINI_API_KEY) return json({ error: 'ভয়েস তৈরির জন্য GEMINI_API_KEY Secret প্রয়োজন।' }, 503, request);
      let body;
      try { body = await readJson(request); }
      catch { return json({ error: 'Invalid JSON request.' }, 400, request); }
      const text = str(body.text, 4000).trim();
      if (!text) return json({ error: 'Voice script is required.' }, 400, request);
      if (body.voiceReferenceAudioBase64) return json({ error: 'এই Worker-এ raw reference audio দিয়ে voice cloning চালু নেই। সাধারণ male/female/dual TTS ব্যবহার করুন; voice replication-এর জন্য আলাদা provider voice ID/workflow প্রয়োজন।' }, 400, request);
      const language = str(body.language, 20) || 'bn-BD';
      const mode = ['male', 'female', 'dual'].includes(body.mode) ? body.mode : 'female';
      const speed = Math.max(0.7, Math.min(1.3, Number(body.speed) || 1));
      const pace = speed < 0.9 ? 'slowly and clearly' : speed > 1.1 ? 'briskly and clearly' : 'at a natural conversational pace';
      const styleChoice = str(body.voiceStyle, 40);
      const styleName = ({ natural: 'natural narration', announcement: 'public-address announcement, clear and projected', news: 'professional news presenter', calm: 'calm and reassuring narration' })[styleChoice] || 'natural clear narration';
      const languageName = ({ 'bn-BD': 'Bengali as spoken in Bangladesh', 'en-US': 'English', 'ur-PK': 'Urdu', 'hi-IN': 'Hindi', 'ar-SA': 'Arabic' })[language] || language;
      const model = env.GEMINI_TTS_MODEL || DEFAULT_TTS_MODEL;
      try {
        let input;
        let speechConfig;
        if (mode === 'dual') {
          const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
          if (lines.length < 2) return json({ error: 'দুই কণ্ঠের জন্য অন্তত ২টি আলাদা লাইন দিন।' }, 400, request);
          input = [{
            type: 'user_input',
            content: lines.map((line, index) => ({
              type: 'text',
              text: line,
              annotations: [{
                type: 'speech_metadata',
                speaker: index % 2 === 0 ? 'FemaleSpeaker' : 'MaleSpeaker',
                style: `${languageName}; ${styleName}; ${pace}; read this line verbatim`
              }]
            }))
          }];
          speechConfig = [
            { speaker: 'FemaleSpeaker', voice: 'Kore' },
            { speaker: 'MaleSpeaker', voice: 'Puck' }
          ];
        } else {
          input = [{
            type: 'user_input',
            content: [{
              type: 'text',
              text,
              annotations: [{ type: 'speech_metadata', style: `${languageName}; ${styleName}; ${pace}; read the supplied text verbatim` }]
            }]
          }];
          speechConfig = [{ voice: mode === 'female' ? 'Kore' : 'Puck' }];
        }
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
          method: 'POST',
          headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, input, response_format: { type: 'audio' }, generation_config: { speech_config: speechConfig } })
        });
        const data = await providerJson(response);
        if (!response.ok) return json({ error: data?.error?.message || `Gemini TTS HTTP ${response.status}. Check model access, quota and billing.` }, response.status === 429 ? 429 : 502, request);
        const audio = outputAudio(data);
        if (!audio?.data) return json({ error: 'TTS API returned no audio data. Check Gemini TTS model access and Worker logs.' }, 502, request);
        return json({ audioBase64: audio.data, mimeType: audio.mime_type || 'audio/wav', provider: 'gemini', model }, 200, request);
      } catch (error) {
        return json({ error: `TTS request failed: ${error?.message || 'Unknown error'}` }, 502, request);
      }
    }

    if (url.pathname === '/api/video' && request.method === 'POST') {
      if (!env.RUNWAY_API_KEY) return json({ error: 'ভিডিও তৈরির জন্য RUNWAY_API_KEY Cloudflare Secret প্রয়োজন।' }, 503, request);
      let body;
      try { body = await readJson(request); }
      catch { return json({ error: 'Invalid JSON request.' }, 400, request); }
      const prompt = str(body.prompt, 1000).trim();
      if (!prompt) return json({ error: 'Video prompt is required (max 1000 characters).' }, 400, request);
      const supportedModels = ['gen4.5', 'veo3.1', 'veo3.1_fast', 'klingO3_4k', 'hailuo3', 'kling3.0_4k', 'happyhorse_1_0', 'kling2.5_turbo_pro', 'kling3.0_pro', 'kling3.0_standard', 'klingO3_pro', 'klingO3_standard', 'seedance2', 'seedance2_fast', 'seedance2_mini', 'gemini_omni_flash', 'gemini_omni_flash_1.1', 'grok_imagine_1_5', 'grok_imagine_1_5_lite', 'wan3', 'wan3_prime', 'h3_max', 'seedance2_5'];
      const configured = str(env.RUNWAY_VIDEO_MODEL, 80) || 'gen4.5';
      const model = supportedModels.includes(body.model) ? body.model : (supportedModels.includes(configured) ? configured : 'gen4.5');
      const duration = Math.max(2, Math.min(10, Math.floor(Number(body.duration) || 5)));
      const ratio = ['1280:720', '720:1280'].includes(body.ratio) ? body.ratio : '1280:720';
      try {
        const response = await fetch('https://api.dev.runwayml.com/v1/text_to_video', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RUNWAY_API_KEY}`, 'Content-Type': 'application/json', 'X-Runway-Version': '2024-11-06' },
          body: JSON.stringify({ model, promptText: prompt, ratio, duration })
        });
        const data = await providerJson(response);
        if (!response.ok) return json({ error: data?.error || data?.message || `Runway video API HTTP ${response.status}. Check credits, model access and request settings.` }, response.status === 429 ? 429 : 502, request);
        const taskId = data?.id || data?.taskId;
        if (!taskId) return json({ error: 'Runway did not return a task ID.' }, 502, request);
        return json({ taskId, status: data?.status || 'PENDING', provider: 'runway', model }, 200, request);
      } catch (error) {
        return json({ error: `Video request failed: ${error?.message || 'Unknown error'}` }, 502, request);
      }
    }

    if (url.pathname === '/api/video/status' && request.method === 'GET') {
      if (!env.RUNWAY_API_KEY) return json({ error: 'RUNWAY_API_KEY is not configured.' }, 503, request);
      const taskId = url.searchParams.get('taskId') || '';
      if (!/^[\w-]{6,120}$/.test(taskId)) return json({ error: 'Invalid video task ID.' }, 400, request);
      try {
        const response = await fetch(`https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${env.RUNWAY_API_KEY}`, 'X-Runway-Version': '2024-11-06' }
        });
        const data = await providerJson(response);
        if (!response.ok) return json({ error: data?.error || data?.message || `Runway task HTTP ${response.status}` }, response.status === 429 ? 429 : 502, request);
        const output = Array.isArray(data?.output) ? data.output : [];
        return json({ taskId, status: data?.status || 'UNKNOWN', videoUrl: output[0] || null, output, error: data?.failure || data?.error || null }, 200, request);
      } catch (error) {
        return json({ error: `Video status failed: ${error?.message || 'Unknown error'}` }, 502, request);
      }
    }

    return json({ error: 'API route not found.' }, 404, request);
  }
};
