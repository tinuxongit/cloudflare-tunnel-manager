export type ConnectionMode = 'local' | 'remote';

export type RemoteConfig = {
  baseUrl: string; // e.g. "http://192.168.1.50:8088"
  token: string;
};

type Stored = { mode: ConnectionMode; remote: RemoteConfig | null };

const KEY = 'cf-tunnel-manager:connection';

export function loadConnection(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { mode: 'local', remote: null };
}

export function saveConnection(s: Stored) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

let cached: Stored | null = null;

export function getConnection(): Stored {
  if (!cached) cached = loadConnection();
  return cached;
}

export function setConnection(s: Stored) {
  cached = s;
  saveConnection(s);
}
