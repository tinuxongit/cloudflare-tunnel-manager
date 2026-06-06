/**
 * Unified per-job event stream. Caller doesn't care whether the work runs in
 * the local Tauri process (events flow through `app.emit()` → `listen()`) or
 * on a remote connector (SSE). Both surfaces emit the same `ProjectProgress`
 * shape; this helper picks the right transport based on connection mode.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getConnection } from './connection';
import { openJobStream } from './sse';

export type Stop = () => void | Promise<void>;

export async function streamProjectProgress(
  eventId: string,
  onEvent: (payload: any) => void,
): Promise<Stop> {
  if (getConnection().mode === 'remote') {
    return openJobStream(eventId, onEvent);
  }
  const channel = `project-create://${eventId}/progress`;
  const unlisten: UnlistenFn = await listen<any>(channel, (e) => onEvent(e.payload));
  return () => unlisten();
}

export async function streamWorkerTail(
  tailId: string,
  onEvent: (payload: any) => void,
): Promise<Stop> {
  if (getConnection().mode === 'remote') {
    return openJobStream(tailId, onEvent);
  }
  const channel = `worker-tail://${tailId}/event`;
  const unlisten: UnlistenFn = await listen<any>(channel, (e) => onEvent(e.payload));
  return () => unlisten();
}
