/**
 * Tiny SSE client over fetch streaming. Browser EventSource can't send
 * Authorization headers, so we parse the `data: …\n\n` framing ourselves.
 *
 * Two modes:
 *   - openJobStream(eventId, onEvent)   — per-job progress (project create,
 *                                          redeploy, install, tail)
 *   - openStateStream(onEvent)          — global realtime state-change feed
 *
 * Both return a `close()` function that aborts the underlying fetch.
 */

import { getConnection } from './connection';

type Stop = () => void;

async function consume(
  path: string,
  onEvent: (data: any) => void,
  signal: AbortSignal,
): Promise<void> {
  const { remote } = getConnection();
  if (!remote) throw new Error('No remote connector configured');
  const res = await fetch(`${remote.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${remote.token}` },
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`SSE open failed: HTTP ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  // SSE frames are separated by a blank line. Each frame may have multiple
  // "data: …" lines that concatenate (joined by '\n').
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let split: number;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const dataLines = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart());
      if (dataLines.length === 0) continue;
      const raw = dataLines.join('\n');
      try {
        onEvent(JSON.parse(raw));
      } catch {
        onEvent({ raw });
      }
    }
  }
}

export function openJobStream(eventId: string, onEvent: (data: any) => void): Stop {
  const ctrl = new AbortController();
  consume(`/events/${encodeURIComponent(eventId)}`, onEvent, ctrl.signal).catch((e) => {
    if (ctrl.signal.aborted) return;
    onEvent({ kind: 'error', step: 'deploy', message: e?.message ?? String(e) });
  });
  return () => ctrl.abort();
}

export function openStateStream(onEvent: (data: any) => void): Stop {
  const ctrl = new AbortController();
  consume('/events', onEvent, ctrl.signal).catch((e) => {
    if (ctrl.signal.aborted) return;
    console.error('[state stream]', e);
  });
  return () => ctrl.abort();
}
