/** Клиент SSE для integration-тестов: читает поток `fetch` и копит события `{ id, type, data }`. */
export interface SseEvent {
  id: string | null;
  type: string;
  data: unknown;
  at: number;
}

export interface SseClient {
  events: SseEvent[];
  status: Promise<number>;
  /** Ждёт событие, удовлетворяющее условию (из уже полученных или новых). */
  next: (pred: (e: SseEvent) => boolean, timeoutMs?: number) => Promise<SseEvent>;
  closed: Promise<void>;
  close: () => void;
}

export function openSse(url: string, cookie: string): SseClient {
  const controller = new AbortController();
  const events: SseEvent[] = [];
  const waiters: Array<{ pred: (e: SseEvent) => boolean; resolve: (e: SseEvent) => void }> = [];
  let statusResolve!: (n: number) => void;
  const status = new Promise<number>((r) => (statusResolve = r));
  const push = (e: SseEvent) => {
    events.push(e);
    for (const w of [...waiters]) {
      if (w.pred(e)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(e);
      }
    }
  };
  const closed = (async () => {
    try {
      const res = await fetch(url, {
        headers: { Cookie: cookie, Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      statusResolve(res.status);
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let split: number;
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          let id: string | null = null;
          let type = 'message';
          const data: string[] = [];
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) continue;
            if (line.startsWith('id: ')) id = line.slice(4);
            else if (line.startsWith('event: ')) type = line.slice(7);
            else if (line.startsWith('data: ')) data.push(line.slice(6));
          }
          if (data.length) push({ id, type, data: JSON.parse(data.join('\n')), at: Date.now() });
        }
      }
    } catch {
      statusResolve(0);
    }
  })();
  return {
    events,
    status,
    closed,
    close: () => controller.abort(),
    next: (pred, timeoutMs = 5_000) => {
      const found = events.find(pred);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('SSE event timeout')), timeoutMs);
        waiters.push({
          pred,
          resolve: (e) => {
            clearTimeout(timer);
            resolve(e);
          },
        });
      });
    },
  };
}
