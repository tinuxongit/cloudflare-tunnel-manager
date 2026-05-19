export type Page = {
  id: number; hostname: string; service_url: string;
  tunnel_uuid: string; enabled: boolean; created_at: string;
};

export type NewPageInput = { hostname: string; service_url: string; tunnel_uuid: string; };
export type PagePatch = Partial<{ hostname: string; service_url: string; tunnel_uuid: string; enabled: boolean; }>;

export type Tunnel = { uuid: string; name: string; cred_path: string; managed: boolean; last_seen: string; };

export type Settings = {
  grouping_mode: 'shared' | 'isolated';
  shared_tunnel_uuid: string | null;
  cloudflared_path: string | null;
  theme: 'dark' | 'light' | 'system';
  start_on_boot: boolean;
};
export type SettingsPatch = Partial<Settings>;

export type RuntimeStatus = {
  state: 'running' | 'starting' | 'error' | 'stopped';
  connections: number | null;
  edge_region: string | null;
  requests_per_s: number | null;
  p50_ms: number | null;
  errors_total: number | null;
};

export type LogLine = { stream: 'stdout' | 'stderr'; text: string; ts_ms: number; };

export type ServiceHealth = {
  reachable: boolean; latency_ms: number | null;
  http_status: number | null; reason: string | null;
};

export type CloudflaredInfo = {
  path: string; version: string; logged_in: boolean; cert_path: string;
};

export type AppError = { code: string; message: string; detail: string | null };

export type Zone = {
  id: string;
  name: string;
  status: string;
  account_name: string | null;
};
