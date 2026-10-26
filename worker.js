
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

const SYSTEM_INSTRUCTION =
  'You are NIVORA AI inside NIVORA ONE. Answer in the user\'s language, preferably Bengali when they write Bengali. Help with questions, writing, translation, coding, debugging, planning and analysis. Do not claim an action or integration happened unless it did. Treat forecasts as estimates, not guarantees.';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });

const str = (v, n = 30000) =>
  typeof v === 'string' ? v.slice(0, n) : '';

const readJson = async request => {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 7000000) throw new Error('Request too large.');
  return await request.json();
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          }
        });
      }

      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({
          status: 'online',
          aiConfigured: !!(
            env.GEMINI_API_KEY ||
            env.OPENAI_API_KEY ||
            env.GROQ_API_KEY
          ),
          imageConfigured: !!(
            env.GEMINI_API_KEY || env.OPENAI_API_KEY
          ),
          videoConfigured: !!env.RUNWAY_API_KEY,
          ttsConfigured: !!env.GEMINI_API_KEY,
          promptConfigured: !!env.GEMINI_API_KEY,
          providers: {
            gemini: !!env.GEMINI_API_KEY,
            openai: !!env.OPENAI_API_KEY,
            groq: !!env.GROQ_API_KEY,
            runway: !!env.RUNWAY_API_KEY
          }
        });
      }

      if (url.pathname === '/api/ai' && request.method === 'POST') {
        let body;

        try {
          body = await readJson(request);
        } catch (e) {
          return json({
            error: e.message === 'Request too large.'
              ? e.message
              : 'Invalid JSON request.'
          }, 400);
        }

        const message = str(body.message).trim();
        const attachmentText = str(body.attachmentText, 15000);
        const imageData = str(body.imageData, 5500000);
        const mime = str(body.imageMimeType, 100);
        const requested = str(body.model, 100);

        if (!message && !attachmentText && !imageData) {
          return json({
            error: 'Message or supported attachment required.'
          }, 400);
        }

        try {
          const openai =
            requested.startsWith('gpt-') || requested === 'openai';
          const groq =
            requested.startsWith('groq-') || requested === 'groq';

          let reply = '';

          if (openai || groq) {
            const key = openai
              ? env.OPENAI_API_KEY
              : env.GROQ_API_KEY;

            if (!key) {
              return json({
                error: `${openai ? 'OPENAI_API_KEY' : 'GROQ_API_KEY'} secret is not configured in Cloudflare.`
              }, 503);
            }

            if (imageData) {
              return json({
                error: 'Image understanding with this selected provider is not enabled in this Worker. Select a Gemini model for image input.'
              }, 400);
            }

            const model = openai
              ? (requested.startsWith('gpt-') ? requested : 'gpt-4o-mini')
              : (requested.startsWith('groq-')
                  ? requested.slice(5)
                  : 'llama-3.3-70b-versatile');

            const endpoint = openai
              ? 'https://api.openai.com/v1/chat/completions'
              : 'https://api.groq.com/openai/v1/chat/completions';

            const messages = [{
              role: 'system',
              content: SYSTEM_INSTRUCTION
            }];

            if (Array.isArray(body.history)) {
              for (const item of body.history.slice(-12)) {
                if (
                  ['user', 'assistant'].includes(item?.role) &&
                  typeof item.content === 'string'
                ) {
                  messages.push({
                    role: item.role,
                    content: item.content.slice(0, 12000)
                  });
                }
              }
            }

            messages.push({
              role: 'user',
              content: message + (
                attachmentText
                  ? `\n\nAttached text (${str(body.attachmentName, 120)}):\n${attachmentText}`
                  : ''
              )
            });

            const r = await fetch(endpoint, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model,
                messages,
                temperature: 0.4,
                max_tokens: 4096
              })
            });

            const d = await r.json().catch(() => ({}));

            if (!r.ok) {
              return json({
                error: d?.error?.message || `AI provider HTTP ${r.status}`
              }, r.status === 429 ? 429 : 502);
            }

            reply = d?.choices?.[0]?.message?.content || '';
          } else {
            const key = env.GEMINI_API_KEY;

            if (!key) {
              return json({
                error: 'GEMINI_API_KEY secret is not configured in Cloudflare.'
              }, 503);
            }

            let model = requested.startsWith('gemini-')
              ? requested
              : (env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL);

            if (!/^gemini-[\w.-]+$/.test(model)) {
              model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
            }

            const parts = [{
              text:
                `${SYSTEM_INSTRUCTION}\n\nConversation context:\n` +
                `${Array.isArray(body.history)
                  ? body.history.slice(-8).map(x =>
                      `${x.role === 'assistant' ? 'Assistant' : 'User'}: ${str(x.content, 4000)}`
                    ).join('\n')
                  : ''}\n\nUser request:\n${message}` +
                (attachmentText
                  ? `\n\nAttached text (${str(body.attachmentName, 120)}):\n${attachmentText}`
                  : '')
            }];

            if (imageData) {
              if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) {
                return json({
                  error: 'Unsupported image type. Use PNG, JPEG, WEBP or GIF.'
                }, 400);
              }

              parts.push({
                inline_data: {
                  mime_type: mime,
                  data: imageData
                }
              });
            }

            const r = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ role: 'user', parts }],
                  generationConfig: {
                    temperature: 0.4,
                    maxOutputTokens: 8192
                  }
                })
              }
            );

            const d = await r.json().catch(() => ({}));

            if (!r.ok) {
              return json({
                error: d?.error?.message ||
                  `Gemini HTTP ${r.status}. Check model availability, key, billing and API access.`
              }, r.status === 429 ? 429 : 502);
            }

            reply = (d?.candidates?.[0]?.content?.parts || [])
              .map(p => p.text || '')
              .join('\n')
              .trim();
          }

          return reply
            ? json({ reply })
            : json({ error: 'AI returned an empty response.' }, 502);
        } catch (e) {
          return json({
            error: `AI request failed: ${e?.message || 'Unknown error'}`
          }, 502);
        }
      }

      if (url.pathname === '/api/prompt' && request.method === 'POST') {
        if (!env.GEMINI_API_KEY) {
          return json({
            error: 'প্রম্পট উন্নত করতে GEMINI_API_KEY Secret প্রয়োজন।'
          }, 503);
        }

        let body;
        try {
          body = await readJson(request);
        } catch {
          return json({ error: 'Invalid JSON request.' }, 400);
        }

        const prompt = str(body.prompt, 3000).trim();

        if (!prompt) {
          return json({ error: 'Prompt is required.' }, 400);
        }

        const language = str(body.language, 20) || 'bn';

        const instruction =
          `You are a professional image/video prompt engineer. ` +
          `Rewrite the user's idea as one detailed production-ready prompt ` +
          `in the same language as the user's idea (language hint: ${language}). ` +
          `Preserve the user's intent. Include subject, setting, composition, ` +
          `lighting, camera/lens or motion, visual style, mood, and quality details. ` +
          `For video, include shot progression and movement. ` +
          `Do not add claims or brand logos that the user did not request. ` +
          `Return only the final prompt, no markdown, no explanation. ` +
          `User idea: ${prompt}`;

        try {
          const model = env.GEMINI_MODEL || 'gemini-3.8-flash';

          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  role: 'user',
                  parts: [{ text: instruction }]
                }],
                generationConfig: {
                  temperature: 0.5,
                  maxOutputTokens: 1200
                }
              })
            }
          );

          const d = await r.json().catch(() => ({}));

          if (!r.ok) {
            return json({
              error: d?.error?.message || `Prompt API HTTP ${r.status}`
            }, r.status === 429 ? 429 : 502);
          }

          const result = (d?.candidates?.[0]?.content?.parts || [])
            .map(p => p.text || '')
            .join('\n')
            .trim();

          if (!result) {
            return json({ error: 'AI returned an empty prompt.' }, 502);
          }

          return json({
            prompt: result,
            provider: 'gemini',
            model
          });
        } catch (e) {
          return json({
            error: `Prompt request failed: ${e?.message || 'Unknown error'}`
          }, 502);
        }
      }

      if (url.pathname === '/api/image' && request.method === 'POST') {
        let body;

        try {
          body = await readJson(request);
        } catch {
          return json({
            error: 'Invalid JSON or request too large.'
          }, 400);
        }

        const prompt = str(body.prompt, 4000).trim();

        if (!prompt) {
          return json({ error: 'Image prompt is required.' }, 400);
        }

        try {
          if (env.GEMINI_API_KEY) {
            const model =
              env.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1';

            const r = await fetch(
              'https://generativelanguage.googleapis.com/v1beta/interactions',
              {
                method: 'POST',
                headers: {
                  'x-goog-api-key': env.GEMINI_API_KEY,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  model,
                  input: prompt,
                  response_format: {
                    type: 'image',
                    mime_type: 'image/png',
                    aspect_ratio: '1:1',
                    image_size: '1K'
                  }
                })
              }
            );

            const d = await r.json().catch(() => ({}));

            if (!r.ok) {
              if (!env.OPENAI_API_KEY) {
                return json({
                  error: d?.error?.message ||
                    `Gemini image API HTTP ${r.status}. Check model access and billing.`
                }, r.status === 429 ? 429 : 502);
              }
            } else {
              const item = d?.output_image;

              if (item?.data) {
                return json({
                  imageBase64: item.data,
                  mimeType: item.mime_type || 'image/png',
                  provider: 'gemini'
                });
              }

              const parts = (d?.steps || [])
                .flatMap(x => x.content || []);

              const img = parts.find(
                x => x.type === 'image' && x.data
              );

              if (img) {
                return json({
                  imageBase64: img.data,
                  mimeType: img.mime_type || 'image/png',
                  provider: 'gemini'
                });
              }

              if (!env.OPENAI_API_KEY) {
                return json({
                  error: 'Gemini returned no image data. Check image model access and use /api/health.'
                }, 502);
              }
            }
          }

          if (!env.OPENAI_API_KEY) {
            return json({
              error: 'ছবি তৈরির জন্য GEMINI_API_KEY অথবা OPENAI_API_KEY Cloudflare Worker Secret হিসেবে যোগ করুন।'
            }, 503);
          }

          const r = await fetch(
            'https://api.openai.com/v1/images/generations',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model: env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
                prompt,
                size: '1024x1024'
              })
            }
          );

          const d = await r.json().catch(() => ({}));

          if (!r.ok) {
            return json({
              error: d?.error?.message || `OpenAI image HTTP ${r.status}`
            }, r.status === 429 ? 429 : 502);
          }

          const item = d?.data?.[0];

          if (item?.b64_json) {
            return json({
              imageBase64: item.b64_json,
              mimeType: 'image/png',
              provider: 'openai'
            });
          }

          if (item?.url) {
            return json({
              imageUrl: item.url,
              mimeType: 'image/png',
              provider: 'openai'
            });
          }

          return json({ error: 'Image provider returned no image.' }, 502);
        } catch (e) {
          return json({
            error: `Image request failed: ${e?.message || 'Unknown error'}`
          }, 502);
        }
      }

      if (url.pathname === '/api/tts' && request.method === 'POST') {
        if (!env.GEMINI_API_KEY) {
          return json({
            error: 'ভয়েস তৈরির জন্য GEMINI_API_KEY Cloudflare Worker Secret হিসেবে যোগ করুন।'
          }, 503);
        }

        let body;

        try {
          body = await readJson(request);
        } catch {
          return json({ error: 'Invalid JSON request.' }, 400);
        }

        const text = str(body.text, 4000).trim();
        const language = str(body.language, 20) || 'bn-BD';
        const mode = ['male', 'female', 'dual'].includes(body.mode)
          ? body.mode
          : 'female';

        if (!text) {
          return json({ error: 'Voice script is required.' }, 400);
        }

        const speed = Math.max(
          0.7,
          Math.min(1.3, Number(body.speed) || 1)
        );

        const pace = speed < 0.9
          ? 'speaking slowly and clearly'
          : speed > 1.1
            ? 'speaking briskly and clearly'
            : 'speaking at a natural conversational pace';

        const langName = ({
          'bn-BD': 'Bengali as spoken in Bangladesh',
          'en-US': 'English',
          'ur-PK': 'Urdu',
          'hi-IN': 'Hindi',
          'ar-SA': 'Arabic'
        })[language] || 'Bengali';

        const model =
          env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';

        try {
          let input;
          let speechConfig;

          if (mode === 'dual') {
            const lines = text
              .split(/\n+/)
              .map(x => x.trim())
              .filter(Boolean);

            if (lines.length < 2) {
              return json({
                error: 'দুই কণ্ঠের জন্য অন্তত ২টি আলাদা লাইন দিন। প্রথম লাইন মহিলা, দ্বিতীয় লাইন পুরুষ—এভাবে লিখুন।'
              }, 400);
            }

            const content = lines.map((line, i) => ({
              type: 'text',
              text: line,
              annotations: [{
                type: 'speech_metadata',
                speaker: i % 2 === 0
                  ? 'FemaleSpeaker'
                  : 'MaleSpeaker',
                style: `${langName}; natural, clear advertising announcer; ${pace}; lively but understandable`
              }]
            }));

            input = [{
              type: 'user_input',
              content
            }];

            speechConfig = {
              speakers: [
                { speaker: 'FemaleSpeaker', voice: 'Aoede' },
                { speaker: 'MaleSpeaker', voice: 'Puck' }
              ],
              mode: 'conversational'
            };
          } else {
            const voice = mode === 'female' ? 'Aoede' : 'Puck';

            input = [{
              type: 'user_input',
              content: [{
                type: 'text',
                text,
                annotations: [{
                  type: 'speech_metadata',
                  style: `${langName}; natural ${mode === 'female' ? 'female' : 'male'}-sounding advertising voice; ${pace}; warm, clear pronunciation; speak the supplied words verbatim`
                }]
              }]
            }];

            speechConfig = [{ voice }];
          }

          const r = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/interactions',
            {
              method: 'POST',
              headers: {
                'x-goog-api-key': env.GEMINI_API_KEY,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model,
                input,
                response_format: {
                  type: 'audio',
                  mime_type: 'audio/wav'
                },
                generation_config: {
                  speech_config: speechConfig
                }
              })
            }
          );

          const d = await r.json().catch(() => ({}));

          if (!r.ok) {
            return json({
              error: d?.error?.message ||
                `Gemini TTS HTTP ${r.status}. Check model access, quota and billing.`
            }, r.status === 429 ? 429 : 502);
          }

          const audio =
            d?.output_audio?.data ||
            (d?.steps || [])
              .flatMap(x => x.content || [])
              .find(x => x.type === 'audio' && x.data)?.data;

          if (!audio) {
            return json({
              error: 'TTS API returned no audio data. Check Gemini TTS model access.'
            }, 502);
          }

          return json({
            audioBase64: audio,
            mimeType: d?.output_audio?.mime_type || 'audio/wav',
            provider: 'gemini',
            model
          });
        } catch (e) {
          return json({
            error: `TTS request failed: ${e?.message || 'Unknown error'}`
          }, 502);
        }
      }

      if (url.pathname === '/api/video' && request.method === 'POST') {
        if (!env.RUNWAY_API_KEY) {
          return json({
            error: 'ভিডিও তৈরির জন্য RUNWAY_API_KEY Cloudflare Worker Secret হিসেবে যোগ করুন।'
          }, 503);
        }

        let body;

        try {
          body = await readJson(request);
        } catch {
          return json({ error: 'Invalid JSON request.' }, 400);
        }

        const prompt = str(body.prompt, 1000).trim();

        if (!prompt) {
          return json({
            error: 'Video prompt is required (max 1000 characters).'
          }, 400);
        }

        const model = [
          'gen4.5',
          'veo3.1',
          'veo3.1_fast'
        ].includes(body.model)
          ? body.model
          : (env.RUNWAY_VIDEO_MODEL || 'gen4.5');

        const duration = Number(body.duration) === 10 ? 10 : 5;

        const ratio = [
          '1280:720',
          '720:1280',
          '960:960'
        ].includes(body.ratio)
          ? body.ratio
          : '1280:720';

        try {
          const r = await fetch(
            'https://api.dev.runwayml.com/v1/text_to_video',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${env.RUNWAY_API_KEY}`,
                'Content-Type': 'application/json',
                'X-Runway-Version': '2024-11-06'
              },
              body: JSON.stringify({
                model,
                promptText: prompt,
                ratio,
                duration
              })
            }
          );

          const d = await r.json().catch(() => ({}));

          if (!r.ok) {
            return json({
              error: d?.error || d?.message ||
                `Runway video API HTTP ${r.status}. Check credits, model access and request settings.`
            }, r.status === 429 ? 429 : 502);
          }

          const taskId = d?.id || d?.taskId;

          if (!taskId) {
            return json({ error: 'Runway did not return a task ID.' }, 502);
          }

          return json({
            taskId,
            status: d?.status || 'PENDING',
            provider: 'runway'
          });
        } catch (e) {
          return json({
            error: `Video request failed: ${e?.message || 'Unknown error'}`
          }, 502);
        }
      }

      if (url.pathname === '/api/video/status' && request.method === 'GET') {
        if (!env.RUNWAY_API_KEY) {
          return json({ error: 'RUNWAY_API_KEY is not configured.' }, 503);
        }

        const taskId = url.searchParams.get('taskId') || '';

        if (!/^[\w-]{6,120}$/.test(taskId)) {
          return json({ error: 'Invalid video task ID.' }, 400);
        }

        try {
          const r = await fetch(
            `https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(taskId)}`,
            {
              headers: {
                Authorization: `Bearer ${env.RUNWAY_API_KEY}`,
                'X-Runway-Version': '2024-11-06'
              }
            }
          );

          const d = await r.json().catch(() => ({}));

          if (!r.ok) {
            return json({
              error: d?.error || d?.message ||
                `Runway task HTTP ${r.status}`
            }, 502);
          }

          const output = Array.isArray(d?.output) ? d.output : [];

          return json({
            taskId,
            status: d?.status || 'UNKNOWN',
            videoUrl: output[0] || null,
            output,
            error: d?.failure || d?.error || null
          });
        } catch (e) {
          return json({
            error: `Video status failed: ${e?.message || 'Unknown error'}`
          }, 502);
        }
      }

      return json({ error: 'API route not found.' }, 404);
    }

    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' }
      });
    }

    return env.ASSETS.fetch(request);
  }
};
