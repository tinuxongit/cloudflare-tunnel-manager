export type Page = {
  id: number; hostname: string; service_url: string;
  tunnel_uuid: string; enabled: boolean; created_at: string;
  source_dir: string | null;
  run_command: string | null;
  assigned_port: number | null;
};

export type NewPageInput = {
  hostname: string; service_url: string; tunnel_uuid: string;
  source_dir?: string | null;
  run_command?: string | null;
};
export type PagePatch = Partial<{
  hostname: string; service_url: string; tunnel_uuid: string; enabled: boolean;
  source_dir: string | null; run_command: string | null; assigned_port: number | null;
}>;

export type DetectedKind = 'node_start' | 'node_static' | 'python' | 'static_folder' | 'empty' | 'not_found';
export type Detected = { kind: DetectedKind; command: string; note: string; };

export type Tunnel = { uuid: string; name: string; managed: boolean; last_seen: string; };

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
  path: string; version: string;
};

export type AppError = { code: string; message: string; detail: string | null };

export type Zone = {
  id: string;
  name: string;
  status: string;
  account_name: string | null;
};

// ── Workers ─────────────────────────────────────────────────────────────
export type Worker = {
  id: string;            // script name
  etag: string;
  created_on: string;
  modified_on: string;
};

export type WorkerScript = {
  id: string;
  etag: string;
  modified_on: string;
  compatibility_date: string | null;
  usage_model: string | null;
  logpush: boolean | null;
  bindings: WorkerBinding[];
};

export type WorkerBinding = {
  name: string;
  kind: string;       // d1, kv_namespace, r2_bucket, service, queue, plain_text, etc.
  target: string | null;
};

export type WorkerSecret = {
  name: string;
  kind: string;
};

// ── R2 ──────────────────────────────────────────────────────────────────
export type R2Bucket = {
  name: string;
  creation_date: string;
  location: string | null;
  storage_class: string | null;
};

// ── D1 ──────────────────────────────────────────────────────────────────
export type D1Database = {
  uuid: string;
  name: string;
  version: string;
  created_at: string;
  file_size: number | null;
  num_tables: number | null;
};

export type D1QueryResult = {
  success: boolean;
  error: string | null;
  results: Record<string, unknown>[] | null;
  meta: {
    changes: number | null;
    duration: number | null;
    rows_read: number | null;
    rows_written: number | null;
  } | null;
};

// ── DNS ─────────────────────────────────────────────────────────────────
export type DnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
};

export type NewDnsRecord = {
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
};

// ── Cloudflare Pages ────────────────────────────────────────────────────
export type PagesProject = {
  name: string;
  subdomain: string | null;
  production_branch: string | null;
  domains: string[] | null;
  created_on: string;
};

export type PagesDeployment = {
  id: string;
  environment: string;
  url: string | null;
  created_on: string;
  deployment_trigger: string | null;
};

// ── Project wizard ──────────────────────────────────────────────────────
export type Template = {
  id: string;
  label: string;
  description: string;
  kind: 'worker' | 'pages';
  database: 'none' | 'd1';
};

export type CreateSpec = {
  templateId: string;
  name: string;
  folder: string;
  customDomain: string | null;
};

export type FolderInspection = {
  valid: boolean;
  reason: string | null;
  folder: string;
  name: string | null;
  kind: 'worker' | 'pages';
  hasD1: boolean;
  hasR2: boolean;
  templateGuess: string;
  currentDeployedUrl: string | null;
};

export type ImportSpec = {
  folder: string;
  name: string;
  templateId: string;
  deployedUrl: string | null;
  customDomain: string | null;
};

export type Project = {
  id: number;
  name: string;
  templateId: string;
  folder: string;
  deployedUrl: string | null;
  customDomain: string | null;
  createdAt: string;
  lastDeployedAt: string | null;
};

// ── Setup ───────────────────────────────────────────────────────────────
export type ToolStatus = {
  id: string;
  label: string;
  installed: boolean;
  version: string | null;
  required_for: string;
  importance: 'essential' | 'recommended' | 'optional';
  install: { kind: 'winget' | 'npm-global' | 'manual'; target: string; needs_admin: boolean } | null;
};

export type ProjectStep =
  | 'scaffold' | 'install_deps' | 'create_database' | 'migrate_schema'
  | 'deploy' | 'attach_domain' | 'done';

// ── API tester ──────────────────────────────────────────────────────────
export type HttpRequestSpec = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
};
export type HttpResponse = {
  status: number;
  headers: Array<[string, string]>;
  body: string;
  latencyMs: number;
};

export type PingResult = {
  alive: boolean;
  status: number | null;
  latencyMs: number;
  error: string | null;
};

export type ProjectProgress =
  | { kind: 'step_start'; step: ProjectStep; label: string }
  | { kind: 'line'; line: { stream: 'stdout' | 'stderr'; text: string } }
  | { kind: 'step_done'; step: ProjectStep }
  | { kind: 'success'; url: string | null; folder: string }
  | { kind: 'error'; step: ProjectStep; message: string };

// ── Remote filesystem browser ──────────────────────────────────────────
export type FsEntry = {
  name: string;
  path: string;
  isDir: boolean;
};
export type BrowseResult = {
  path: string;
  parent: string | null;
  entries: FsEntry[];
  roots: string[];
  home: string | null;
};

// ── Realtime state-change events (SSE /events) ─────────────────────────
export type StateEvent =
  | { kind: 'pages_changed' }
  | { kind: 'tunnels_changed' }
  | { kind: 'tunnel_status'; uuid: string; state: 'running' | 'starting' | 'error' | 'stopped' }
  | { kind: 'projects_changed' }
  | { kind: 'settings_changed' }
  | { kind: 'secrets_changed' }
  | { kind: 'tools_changed' }
  | { kind: 'workers_changed' }
  | { kind: 'r2_changed' }
  | { kind: 'd1_changed' }
  | { kind: 'dns_changed' };
