// Server-side chat: same client the phone app uses, fed from config.js. CAL_MOCK_AI=1 returns canned answers.
import { getApiKey, getModel } from './config.js';
import { createChat, AIError } from '../public/core/chat.js';

export { AIError };
const real = createChat({ getKey: getApiKey, getModel });

export async function chatJSON(opts) {
  if (process.env.CAL_MOCK_AI) {
    const { mock } = await import('./mock-ai.js');
    return mock(opts.schemaName);
  }
  return real(opts);
}
