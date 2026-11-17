/* DeepSeek Chat Completions (https://api.deepseek.com).
 *
 * Same wire shape as OpenAI. The documented base has no /v1 on it, and both
 * /v1/chat/completions and /chat/completions answer, so this uses the shared /v1 paths.
 * GET /v1/models is the picker: model ids get retired (deepseek-chat, deepseek-reasoner),
 * so nothing here keeps a list of aliases. defaultModel is only where a fresh setup starts.
 *
 * Thinking is on unless the request says otherwise, at effort "high", and that chain of
 * thought is counted against max_tokens. A short job (ask, debrief, adapt, the admin test
 * ping) sends thinking off. create (including a refine) and review may think, at low
 * effort, so a plan can be reasoned about without the high default eating the answer.
 * response_format accepts text or json_object, not a JSON schema. Temperature is ignored
 * while thinking and does not error, so 0 is always sent.
 */
import { httpAdapter } from './http.js';
import { chatCompletionsSpec } from './openai.js';

const PLAN_KINDS = new Set(['create', 'review']);

const base = chatCompletionsSpec('deepseek', { maxTokensField: 'max_tokens', temperature: 0 });

export const deepseekSpec = {
  ...base,
  body: at => {
    const body = base.body(at);
    // DeepSeek's enum is text | json_object. A json_schema body is a 400, and the
    // compatibility ladder would only find that out after a wasted call.
    if (body.response_format && body.response_format.type === 'json_schema') body.response_format = { type: 'json_object' };
    const thinking = PLAN_KINDS.has(at.kind)
      ? { thinking: { type: 'enabled' }, reasoning_effort: 'low' }
      : { thinking: { type: 'disabled' } };
    return { ...body, ...thinking };
  }
};

export default httpAdapter(deepseekSpec);
