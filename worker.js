
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

function getGeminiModel(env) {
  const configured = String(env.GEMINI_MODEL || '').trim();

  if (!configured || configured.startsWith('gemini-2.5-')) {
    return DEFAULT_GEMINI_MODEL;
  }

  return /^gemini-[\w.-]+$/.test(configured)
    ? configured
    : DEFAULT_GEMINI_MODEL;
}

const SYSTEM_INSTRUCTION =
  'You are NIVORA AI inside NIVORA ONE. Answer in the user language, preferably Bengali when they write Bengali. Help with questions, writing, translation, coding, debugging, planning and analysis. Do not claim an action or integration happened unless it did. Treat forecasts as estimates, not guarantees.';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });

const str = (value, max = 30000) =>
  typeof value === 'string' ? value.slice(0, max) : '';

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);

  if (length > 7000000) {
    throw new Error('Request too large.');
  }

  return request.json();
}

async function readProviderJson(response) {
  return response.json().catch(() => ({}));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': url.origin,
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400'
          }
        });
      }

      // Health and provider configuration
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({
          status: 'online',
          aiConfigured: !!(
            env.GEMINI_API_KEY ||
            env.OPENAI_API_KEY ||
            env.GROQ_API_KEY
          ),
          imageConfigured: !!(
            env.GEMINI_API_KEY ||
            env.OPENAI_API_KEY
          ),
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
            gemini: getGeminiModel(env),
            image: env.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1',
            tts: env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts',
            video: env.RUNWAY_VIDEO_MODEL || 'gen4.5'
          }
        });
      }

      // AI chat: Gemini, OpenAI or Groq
      if (url.pathname === '/api/ai' && request.method === 'POST') {
        let body;

        try {
          body = await readJson(request);
        } catch (error) {
          return json({
            error: error.message === 'Request too large.'
              ? error.message
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

            const response = await fetch(endpoint, {
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

            const data = await readProviderJson(response);

            if (!response.ok) {
              return json({
                error: data?.error?.message ||
                  `AI provider HTTP ${response.status}`
              }, response.status === 429 ? 429 : 502);
            }

            reply = data?.choices?.[0]?.message?.content || '';
          } else {
            const key = env.GEMINI_API_KEY;

            if (!key) {
              return json({
                error: 'GEMINI_API_KEY secret is not configured in Cloudflare.'
              }, 503);
            }

            const model =
              requested.startsWith('gemini-') &&
              !requested.startsWith('gemini-2.5-')
                ? requested
                : getGeminiModel(env);

            const parts = [{
              text:
                `${SYSTEM_INSTRUCTION}\n\nConversation context:\n` +
                `${Array.isArray(body.history)
                  ? body.history.slice(-8).map(item =>
                      `${item.role === 'assistant' ? 'Assistant' : 'User'}: ${str(item.content, 4000)}`
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

            const response = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-goog-api-key': key
                },
                body: JSON.stringify({
                  contents: [{
                    role: 'user',
                    parts
                  }],
                  generationConfig: {
                    temperature: 0.4,
                    maxOutputTokens: 8192
                  }
                })
              }
            );

            const data = await readProviderJson(response);

            if (!response.ok) {
              return json({
                error: data?.error?.message ||
                  `Gemini HTTP ${response.status}. Check model availability, key, billing and API access.`
              }, response.status === 429 ? 429 : 502);
            }

            reply = (data?.candidates?.[0]?.content?.parts || [])
              .map(part => part.text || '')
              .join('\n')
              .trim();
          }

          return reply
            ? json({ reply })
            : json({ error: 'AI returned an empty response.' }, 502);
        } catch (error) {
          return json({
            error: `AI request failed: ${error?.message || 'Unknown error'}`
          }, 502);
        }
      }

      // Prompt improver
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
          const model = getGeminiModel(env);

          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': env.GEMINI_API_KEY
              },
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

          const data = await readProviderJson(response);

          if (!response.ok) {
            return json({
              error: data?.error?.message ||
                `Prompt API HTTP ${response.status}`
            }, response.status === 429 ? 429 : 502);
          }

          const result = (data?.candidates?.[0]?.content?.parts || [])
            .map(part => part.text || '')
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
        } catch (error) {
          return json({
            error: `Prompt request failed: ${error?.message || 'Unknown error'}`
          }, 502);
        }
      }

      // Image generation: Gemini, with OpenAI fallback
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

            const response = await fetch(
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

            const data = await readProviderJson(response);

            if (!response.ok) {
              if (!env.OPENAI_API_KEY) {
                return json({
                  error: data?.error?.message ||
                    `Gemini image API HTTP ${response.status}. Check model access and billing.`
                }, response.status === 429 ? 429 : 502);
              }
            } else {
              const item = data?.output_image;

              if (item?.data) {
                return json({
                  imageBase64: item.data,
                  mimeType: item.mime_type || 'image/png',
                  provider: 'gemini'
                });
              }

              const parts = (data?.steps || [])
                .flatMap(step => step.content || []);

              const image = parts.find(
                item => item.type === 'image' && item.data
              );

              if (image) {
                return json({
                  imageBase64: image.data,
                  mimeType: image.mime_type || 'image/png',
                  provider: 'gemini'
                });
              }

              if (!env.OPENAI_API_KEY) {
                return json({
                  error: 'Gemini returned no image data. Check image model access and billing.'
                }, 502);
              }
            }
          }

          if (!env.OPENAI_API_KEY) {
            return json({
              error: 'ছবি তৈরির জন্য GEMINI_API_KEY অথবা OPENAI_API_KEY Cloudflare Worker Secret হিসেবে যোগ করুন।'
            }, 503);
          }

          const response = await fetch(
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

          const data = await readProviderJson(response);

          if (!response.ok) {
            return json({
              error: data?.error?.message ||
                `OpenAI image HTTP ${response.status}`
            }, response.status === 429 ? 429 : 502);
          }

          const item = data?.data?.[0];

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

          return json({
            error: 'Image provider returned no image.'
          }, 502);
        } catch (error) {
          return json({
            error: `Image request failed: ${error?.message || 'Unknown error'}`
          }, 502);
        }
      }

      // Text-to-speech
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
          ? 'slowly and clearly'
          : speed > 1.1
            ? 'briskly and clearly'
            : 'at a natural conversational pace';

        const languageName = ({
          'bn-BD': 'Bengali as spoken in Bangladesh',
          'en-US': 'English',
          'ur-PK': 'Urdu',
          'hi-IN': 'Hindi',
          'ar-SA': 'Arabic'
        })[language] || language;

        const model =
          env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';

        try {
          let content;
          let speechConfig;

          if (mode === 'dual') {
            const lines = text
              .split(/\n+/)
              .map(line => line.trim())
              .filter(Boolean);

            if (lines.length < 2) {
              return json({
                error: 'দুই কণ্ঠের জন্য অন্তত ২টি আলাদা লাইন দিন।'
              }, 400);
            }

            content = lines.map((line, index) => ({
              type: 'text',
              text: line,
              annotations: [{
                type: 'speech_metadata',
                speaker: index % 2 === 0
                  ? 'FemaleSpeaker'
                  : 'MaleSpeaker',
                style:
                  `${languageName}; natural clear announcement voice; ` +
                  `${pace}; expressive but understandable`
              }]
            }));

            speechConfig = {
              speakers: [
                { speaker: 'FemaleSpeaker', voice: 'Aoede' },
                { speaker: 'MaleSpeaker', voice: 'Puck' }
              ],
              mode: 'conversational'
            };
          } else {
            content = [{
              type: 'text',
              text,
              annotations: [{
                type: 'speech_metadata',
                style:
                  `${languageName}; natural ` +
                  `${mode === 'female' ? 'female' : 'male'}-sounding voice; ` +
                  `${pace}; warm clear pronunciation; read the supplied transcript verbatim`
              }]
            }];

            speechConfig = [{
              voice: mode === 'female' ? 'Aoede' : 'Puck'
            }];
          }

          const response = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/interactions',
            {
              method: 'POST',
              headers: {
                'x-goog-api-key': env.GEMINI_API_KEY,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model,
                input: [{
                  type: 'user_input',
                  content
                }],
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

          const data = await readProviderJson(response);

          if (!response.ok) {
            return json({
              error: data?.error?.message ||
                `Gemini TTS HTTP ${response.status}. Check model access, quota and billing.`
            }, response.status === 429 ? 429 : 502);
          }

          const audio =
            data?.output_audio?.data ||
            (data?.steps || [])
              .flatMap(step => step.content || [])
              .find(item => item.type === 'audio' && item.data)?.data;

          if (!audio) {
            return json({
              error: 'TTS API returned no audio data. Check Gemini TTS model access.'
            }, 502);
          }

          return json({
            audioBase64: audio,
            mimeType: data?.output_audio?.mime_type || 'audio/wav',
            provider: 'gemini',
            model
          });
        } catch (error) {
          return json({
            error: `TTS request failed: ${error?.message || 'Unknown error'}`
          }, 502);
        }
      }

      // Video generation using Runway
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

        const allowedModels = [
          'gen4.5',
          'veo3.1',
          'veo3.1_fast',
          'klingO3_4k',
          'hailuo3',
          'kling3.0_4k',
          'happyhorse_1_0',
          'kling2.5_turbo_pro',
          'kling3.0_pro',
          'kling3.0_standard',
          'klingO3_pro',
          'klingO3_standard',
          'seedance2',
          'seedance2_fast',
          'seedance2_mini',
          'gemini_omni_flash',
          'gemini_omni_flash_1.1',
          'grok_imagine_1_5',
          'wan3',
          'wan3_prime',
          'h3_max',
          'seedance2_5'
        ];

        const configuredModel =
          String(env.RUNWAY_VIDEO_MODEL || 'gen4.5');

        const model = allowedModels.includes(body.model)
          ? body.model
          : allowedModels.includes(configuredModel)
            ? configuredModel
            : 'gen4.5';

        const duration = Math.max(
          2,
          Math.min(10, Math.floor(Number(body.duration) || 5))
        );

        const ratio = ['1280:720', '720:1280'].includes(body.ratio)
          ? body.ratio
          : '1280:720';

        try {
          const response = await fetch(
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

          const data = await readProviderJson(response);

          if (!response.ok) {
            return json({
              error: data?.error || data?.message ||
                `Runway video API HTTP ${response.status}. Check credits, model access and request settings.`
            }, response.status === 429 ? 429 : 502);
          }

          const taskId = data?.id || data?.taskId;

          if (!taskId) {
            return json({
              error: 'Runway did not return a task ID.'
            }, 502);
          }

          return json({
            taskId,
            status: data?.status || 'PENDING',
            provider: 'runway'
          });
        } catch (error) {
          return json({
            error: `Video request failed: ${error?.message || 'Unknown error'}`
          }, 502);
        }
      }

      // Check video generation status
      if (url.pathname === '/api/video/status' && request.method === 'GET') {
        if (!env.RUNWAY_API_KEY) {
          return json({
            error: 'RUNWAY_API_KEY is not configured.'
          }, 503);
        }

        const taskId = url.searchParams.get('taskId') || '';

        if (!/^[\w-]{6,120}$/.test(taskId)) {
          return json({ error: 'Invalid video task ID.' }, 400);
        }

        try {
          const response = await fetch(
            `https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(taskId)}`,
            {
              headers: {
                Authorization: `Bearer ${env.RUNWAY_API_KEY}`,
                'X-Runway-Version': '2024-11-06'
              }
            }
          );

          const data = await readProviderJson(response);

          if (!response.ok) {
            return json({
              error: data?.error || data?.message ||
                `Runway task HTTP ${response.status}`
            }, response.status === 429 ? 429 : 502);
          }

          const output = Array.isArray(data?.output)
            ? data.output
            : [];

          return json({
            taskId,
            status: data?.status || 'UNKNOWN',
            videoUrl: output[0] || null,
            output,
            error: data?.failure || data?.error || null
          });
        } catch (error) {
          return json({
            error: `Video status failed: ${error?.message || 'Unknown error'}`
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
