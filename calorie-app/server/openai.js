import { getApiKey, getModel } from './config.js';

export class AIError extends Error {
  constructor(message, code = 'ai_error', status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const REASONING = /^(gpt-5|o\d)/i;

/**
 * One structured-output vision call. Returns the parsed JSON object.
 * userContent is an OpenAI "content" array (text + image_url parts).
 */
export async function chatJSON({ system, userContent, schema, schemaName, model, temperature = 0.2, maxTokens = 6000 }) {
  if (process.env.CAL_MOCK_AI) {
    const { mock } = await import('./mock-ai.js');
    return mock(schemaName, { temperature });
  }
  const key = getApiKey();
  if (!key) throw new AIError('No OpenAI API key yet. Add it in Settings (one time) or put it in .env.', 'no_key', 400);
  model = model || getModel();

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
    max_completion_tokens: maxTokens,
  };
  if (!REASONING.test(model)) body.temperature = temperature;

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(150_000),
    });
  } catch (e) {
    throw new AIError(`Could not reach OpenAI: ${e.cause?.code || e.message}`, 'network', 502);
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    const msg = json?.error?.message || text.slice(0, 200);
    if (res.status === 401) throw new AIError('OpenAI rejected the API key. Check it in Settings.', 'bad_key', 401);
    if (res.status === 429) throw new AIError(`OpenAI rate limit or quota: ${msg}`, 'rate_limit', 429);
    if (res.status === 404 || /model/i.test(msg)) throw new AIError(`Model problem (${model}): ${msg}`, 'bad_model', 400);
    throw new AIError(`OpenAI error ${res.status}: ${msg}`, 'openai', 502);
  }
  const choice = json?.choices?.[0];
  if (choice?.message?.refusal) throw new AIError(`The model declined: ${choice.message.refusal}`, 'refusal', 422);
  if (!choice?.message?.content) throw new AIError('OpenAI returned an empty answer.', 'empty', 502);
  try {
    return JSON.parse(choice.message.content);
  } catch {
    throw new AIError('OpenAI returned something that was not valid JSON (maybe cut off). Try again.', 'bad_json', 502);
  }
}

export function imageParts(images) {
  return images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } }));
}
