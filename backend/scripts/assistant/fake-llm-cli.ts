import { FakeLlm } from './fake-llm.js';

/**
 * Runs two stand-in vendors so the assistant can be tried locally with no Groq or OpenAI account
 * (`npm run assistant:fake-llm`). Answers follow a fixed policy, not a model. Add the printed lines
 * to `backend/.env`, restart the API, and run `npm run assistant:index`.
 *
 * Reads `process.env` directly and does not load the application's env validation.
 */
const groqPort = Number(process.env.FAKE_GROQ_PORT ?? 4110);
const openaiPort = Number(process.env.FAKE_OPENAI_PORT ?? 4111);
const groqKey = 'local-fake-groq-key';
const openaiKey = 'local-fake-openai-key';

const groq = new FakeLlm({ apiKey: groqKey, port: groqPort, groqUsage: true });
const openai = new FakeLlm({ apiKey: openaiKey, port: openaiPort });

await groq.start();
await openai.start();

process.stdout.write(
  [
    `Fake Groq listening on ${groq.baseUrl}, fake OpenAI on ${openai.baseUrl}`,
    'Add to backend/.env, then restart the API:',
    `  GROQ_BASE_URL=${groq.baseUrl}`,
    `  GROQ_API_KEY=${groqKey}`,
    '  GROQ_CHAT_MODEL=fake-groq-model',
    `  OPENAI_BASE_URL=${openai.baseUrl}`,
    `  OPENAI_API_KEY=${openaiKey}`,
    '  OPENAI_CHAT_MODEL=fake-openai-model',
    '',
  ].join('\n'),
);
