import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { loadEnv } from '../src/config/env';
import { createRealProvider, redactSecret } from '../src/modules/ai/ai-sdk-provider';
import { type Prompt, ProviderUnavailableError, type Usage } from '../src/modules/ai/llm-provider';

const KEY = 'sk-test-secret-key-0123456789';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'b',
  S3_ACCESS_KEY: 'k',
  S3_SECRET_KEY: 's',
  SESSION_SECRET: 's'.repeat(64),
  APP_BASE_URL: 'http://localhost:3000',
};

const prompt: Prompt = {
  system: 'You are Syntara, a learning tutor.',
  messages: [{ role: 'user', content: 'Почему у сердца четыре камеры?' }],
  locale: 'ru',
};

interface Captured {
  url: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

/** Локальный «поставщик»: отвечает потоком в формате OpenAI Chat Completions или Anthropic Messages. */
function fakeServer(handler: (req: Captured, res: ServerResponse) => void) {
  const captured: Captured[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => {
      const entry = { url: req.url ?? '', headers: req.headers, body: JSON.parse(raw || '{}') };
      captured.push(entry);
      handler(entry, res);
    });
  });
  return new Promise<{ url: string; captured: Captured[]; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, captured, close: () => server.close() });
    });
  });
}

const sse = (res: ServerResponse, events: Array<{ event?: string; data: unknown }>) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const e of events) {
    res.write(
      `${e.event ? `event: ${e.event}\n` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`,
    );
  }
  res.end();
};

const openAiChunk = (delta: object, extra: object = {}) => ({
  id: 'c1',
  object: 'chat.completion.chunk',
  created: 1,
  model: 'test-model',
  choices: [{ index: 0, delta, finish_reason: null }],
  ...extra,
});

async function collect(stream: AsyncIterable<string>) {
  let text = '';
  for await (const part of stream) text += part;
  return text;
}

/** Адаптер реальной модели (Vercel AI SDK, раздел 2.1) за LLMProvider (BR-AI-01) — без настоящего поставщика. */
describe('LLM adapter (Vercel AI SDK)', () => {
  it('BR-AI-01 openai-compatible: streams text deltas, reports usage, sends the key only in the Authorization header', async () => {
    const fake = await fakeServer((_req, res) =>
      sse(res, [
        { data: openAiChunk({ role: 'assistant', content: 'Представь, ' }) },
        { data: openAiChunk({ content: 'что сердце — дом.' }) },
        {
          data: {
            ...openAiChunk({}),
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
          },
        },
        { data: '[DONE]' },
      ]),
    );
    try {
      const env = loadEnv({
        ...base,
        LLM_PROVIDER: 'openai-compatible',
        LLM_API_KEY: KEY,
        LLM_MODEL: 'test-model',
        LLM_BASE_URL: `${fake.url}/v1`,
      });
      const provider = createRealProvider(env)!;
      let usage: Usage | null = null;
      const text = await collect(provider.stream(prompt, new AbortController().signal, (u) => (usage = u)));
      expect(text).toBe('Представь, что сердце — дом.');
      expect(usage).toEqual({ tokensIn: 42, tokensOut: 7 });
      const [req] = fake.captured;
      expect(req!.url).toBe('/v1/chat/completions');
      expect(req!.headers.authorization).toBe(`Bearer ${KEY}`);
      expect(req!.body).toMatchObject({
        model: 'test-model',
        stream: true,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.messages[0]!.content },
        ],
      });
      // BR-AI-03: модели не передаются инструменты — она только генерирует текст.
      expect(req!.body.tools).toBeUndefined();
    } finally {
      fake.close();
    }
  });

  it('BR-AI-01 anthropic: streams text deltas and usage; the key goes in x-api-key', async () => {
    const fake = await fakeServer((_req, res) =>
      sse(res, [
        {
          event: 'message_start',
          data: {
            type: 'message_start',
            message: {
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              model: 'test-model',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 30, output_tokens: 1 },
            },
          },
        },
        {
          event: 'content_block_start',
          data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        },
        {
          event: 'content_block_delta',
          data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Четыре ' } },
        },
        {
          event: 'content_block_delta',
          data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'камеры.' } },
        },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
        {
          event: 'message_delta',
          data: {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 5 },
          },
        },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ]),
    );
    try {
      const env = loadEnv({
        ...base,
        LLM_PROVIDER: 'anthropic',
        LLM_API_KEY: KEY,
        LLM_MODEL: 'test-model',
        LLM_BASE_URL: `${fake.url}/v1`,
      });
      const provider = createRealProvider(env)!;
      let usage: Usage | null = null;
      const text = await collect(provider.stream(prompt, new AbortController().signal, (u) => (usage = u)));
      expect(text).toBe('Четыре камеры.');
      expect(usage).toEqual({ tokensIn: 30, tokensOut: 5 });
      const [req] = fake.captured;
      expect(req!.url).toBe('/v1/messages');
      expect(req!.headers['x-api-key']).toBe(KEY);
      expect(req!.body).toMatchObject({
        model: 'test-model',
        system: [{ type: 'text', text: prompt.system }],
      });
      expect(req!.body.tools).toBeUndefined();
    } finally {
      fake.close();
    }
  });

  it('AG-10, REQ-NFR-SEC-07 provider errors never carry the API key', async () => {
    // Поставщик «по ошибке» возвращает ключ в тексте ошибки — он не должен дойти до журналов.
    const fake = await fakeServer((req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Invalid key ${String(req.headers.authorization)}` } }));
    });
    try {
      const env = loadEnv({
        ...base,
        LLM_PROVIDER: 'openai-compatible',
        LLM_API_KEY: KEY,
        LLM_MODEL: 'test-model',
        LLM_BASE_URL: `${fake.url}/v1`,
      });
      const provider = createRealProvider(env)!;
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const error = await collect(provider.stream(prompt, new AbortController().signal)).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ProviderUnavailableError);
      expect((error as Error).message).not.toContain(KEY);
      expect(JSON.stringify(logged.mock.calls)).not.toContain(KEY);
      logged.mockRestore();
      expect(redactSecret(`a ${KEY} b ${KEY}`, KEY)).toBe('a [REDACTED] b [REDACTED]');
    } finally {
      fake.close();
    }
  });

  it('BR-AI-06 LLM_PROVIDER = mock → no real provider (PH-19)', () => {
    expect(createRealProvider(loadEnv(base))).toBeNull();
  });
});
