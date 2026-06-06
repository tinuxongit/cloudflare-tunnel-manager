import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { getConnection } from './connection';
import type * as T from './types';

type Args = Record<string, unknown> | undefined;

async function callLocal<R>(cmd: string, args?: Args): Promise<R> {
  try {
    return await tauriInvoke<R>(cmd, args);
  } catch (e) {
    throw e as T.AppError;
  }
}

async function callRemote<R>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<R> {
  const { remote } = getConnection();
  if (!remote)
    throw {
      code: 'NO_REMOTE',
      message: 'No remote connector configured',
      detail: null,
    } as T.AppError;
  const res = await fetch(`${remote.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${remote.token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {}
    throw (
      parsed && typeof parsed === 'object'
        ? parsed
        : { code: `HTTP_${res.status}`, message: text || res.statusText, detail: null }
    ) as T.AppError;
  }
  if (res.status === 204) return undefined as unknown as R;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return (await res.json()) as R;
  return (await res.text()) as unknown as R;
}

function isRemote() {
  return getConnection().mode === 'remote';
}

export const api = {
  listPages: () =>
    isRemote() ? callRemote<T.Page[]>('GET', '/pages') : callLocal<T.Page[]>('list_pages'),

  createPage: (input: T.NewPageInput) =>
    isRemote()
      ? callRemote<T.Page>('POST', '/pages', input)
      : callLocal<T.Page>('create_page', { input }),

  updatePage: (id: number, patch: T.PagePatch) =>
    isRemote()
      ? callRemote<T.Page>('PATCH', `/pages/${id}`, patch)
      : callLocal<T.Page>('update_page', { id, patch }),

  deletePage: (id: number) =>
    isRemote()
      ? callRemote<void>('DELETE', `/pages/${id}`)
      : callLocal<void>('delete_page', { id }),

  togglePage: (id: number, on: boolean) =>
    isRemote()
      ? callRemote<T.Page>('POST', `/pages/${id}/toggle`, { on })
      : callLocal<T.Page>('toggle_page', { id, on }),

  startOrRestartForPage: (page_id: number) =>
    isRemote()
      ? callRemote<void>('POST', `/pages/${page_id}/start-or-restart`)
      : callLocal<void>('start_or_restart_for_page', { pageId: page_id }),

  listTunnels: () =>
    isRemote()
      ? callRemote<T.Tunnel[]>('GET', '/tunnels')
      : callLocal<T.Tunnel[]>('list_tunnels'),

  createTunnel: (name: string) =>
    isRemote()
      ? callRemote<T.Tunnel>('POST', '/tunnels', { name })
      : callLocal<T.Tunnel>('create_tunnel', { name }),

  deleteTunnel: (uuid: string) =>
    isRemote()
      ? callRemote<void>('DELETE', `/tunnels/${uuid}`)
      : callLocal<void>('delete_tunnel', { uuid }),

  routeDnsViaApi: (
    zone_id: string,
    hostname: string,
    tunnel_uuid: string,
    overwrite = false,
  ) =>
    isRemote()
      ? callRemote<void>('POST', '/dns/route', {
          zone_id,
          hostname,
          tunnel_uuid,
          overwrite,
        })
      : callLocal<void>('route_dns_via_api', {
          zoneId: zone_id,
          hostname,
          tunnelUuid: tunnel_uuid,
          overwrite,
        }),

  getStatus: (tunnel_uuid: string) =>
    isRemote()
      ? callRemote<T.RuntimeStatus>(
          'GET',
          `/tunnels/${encodeURIComponent(tunnel_uuid)}/status`,
        )
      : callLocal<T.RuntimeStatus>('get_status', { tunnelUuid: tunnel_uuid }),

  getLogs: (tunnel_uuid: string, last_n = 500) =>
    isRemote()
      ? callRemote<T.LogLine[]>(
          'GET',
          `/tunnels/${encodeURIComponent(tunnel_uuid)}/logs?lastN=${last_n}`,
        )
      : callLocal<T.LogLine[]>('get_logs', { tunnelUuid: tunnel_uuid, lastN: last_n }),

  stopTunnel: (uuid: string) =>
    isRemote()
      ? callRemote<void>('POST', `/tunnels/${uuid}/stop`)
      : callLocal<void>('stop_tunnel', { uuid }),

  checkLocalService: (url: string) =>
    isRemote()
      ? callRemote<T.ServiceHealth>('POST', '/check-local-service', { url })
      : callLocal<T.ServiceHealth>('check_local_service', { url }),

  cloudflaredInfo: () =>
    isRemote()
      ? callRemote<T.CloudflaredInfo>('GET', '/system/cloudflared')
      : callLocal<T.CloudflaredInfo>('cloudflared_info'),

  getSettings: () =>
    isRemote()
      ? callRemote<T.Settings>('GET', '/settings')
      : callLocal<T.Settings>('get_settings'),

  setSettings: (patch: T.SettingsPatch) =>
    isRemote()
      ? callRemote<T.Settings>('PATCH', '/settings', patch)
      : callLocal<T.Settings>('set_settings', { patch }),

  // Secret/credential management ALWAYS reads + writes the laptop's local
  // keyring, regardless of mode. Switching to Remote mode does NOT log you
  // out of your CF account — the studio's CF identity follows the laptop.
  // After pairing, the laptop's credentials are pushed to the connector via
  // /credentials/sync so the server can use the same account for the few
  // things (project deploys, etc.) that need server-side CF auth.
  setApiToken: async (token: string) => {
    await callLocal<void>('set_api_token', { token });
    if (isRemote()) await pushCredentialsToServer().catch(() => {});
  },
  clearApiToken: async () => {
    await callLocal<void>('clear_api_token');
    if (isRemote()) {
      // Best-effort wipe on the server too so the two sides match.
      await callRemote<void>('DELETE', '/secrets/api-token').catch(() => {});
    }
  },
  hasApiToken: () => callLocal<boolean>('has_api_token'),
  getApiToken: () => callLocal<string | null>('get_api_token'),
  verifyApiToken: () => callLocal<void>('verify_api_token'),

  listZones: () =>
    isRemote()
      ? callRemote<T.Zone[]>('GET', '/zones')
      : callLocal<T.Zone[]>('list_zones'),

  // Global key — same rule as API token. Local keyring is source of truth.
  setGlobalKey: async (email: string, key: string) => {
    await callLocal<void>('set_global_key', { email, key });
    if (isRemote()) await pushCredentialsToServer().catch(() => {});
  },
  clearGlobalKey: async () => {
    await callLocal<void>('clear_global_key');
    if (isRemote()) await callRemote<void>('DELETE', '/secrets/global-key').catch(() => {});
  },
  hasGlobalKey: () => callLocal<boolean>('has_global_key'),
  getGlobalKey: () => callLocal<[string, string] | null>('get_global_key'),

  detectFolder: (path: string) =>
    isRemote()
      ? callRemote<T.Detected>('POST', '/folder/detect', { path })
      : callLocal<T.Detected>('detect_folder', { path }),

  writeSetupGuide: (path: string) =>
    isRemote()
      ? callRemote<string>('POST', '/folder/setup-guide', { path })
      : callLocal<string>('write_setup_guide', { path }),

  getLocalLogs: (page_id: number, last_n = 500) =>
    isRemote()
      ? callRemote<T.LogLine[]>('GET', `/pages/${page_id}/local-logs?lastN=${last_n}`)
      : callLocal<T.LogLine[]>('get_local_logs', { pageId: page_id, lastN: last_n }),

  localIsRunning: (page_id: number) =>
    isRemote()
      ? callRemote<boolean>('GET', `/pages/${page_id}/local-running`)
      : callLocal<boolean>('local_is_running', { pageId: page_id }),

  // ── Workers ─────────────────────────────────────────────────────────
  listWorkers: () =>
    isRemote()
      ? callRemote<T.Worker[]>('GET', '/workers')
      : callLocal<T.Worker[]>('list_workers'),
  getWorker: (id: string) =>
    isRemote()
      ? callRemote<T.WorkerScript>('GET', `/workers/${encodeURIComponent(id)}`)
      : callLocal<T.WorkerScript>('get_worker', { id }),
  deleteWorker: (id: string) =>
    isRemote()
      ? callRemote<void>('DELETE', `/workers/${encodeURIComponent(id)}`)
      : callLocal<void>('delete_worker', { id }),
  listWorkerSecrets: (id: string) =>
    isRemote()
      ? callRemote<T.WorkerSecret[]>('GET', `/workers/${encodeURIComponent(id)}/secrets`)
      : callLocal<T.WorkerSecret[]>('list_worker_secrets', { id }),
  putWorkerSecret: (id: string, name: string, value: string) =>
    isRemote()
      ? callRemote<void>('PUT', `/workers/${encodeURIComponent(id)}/secrets`, { name, value })
      : callLocal<void>('put_worker_secret', { id, name, value }),
  deleteWorkerSecret: (id: string, name: string) =>
    isRemote()
      ? callRemote<void>('DELETE', `/workers/${encodeURIComponent(id)}/secrets/${encodeURIComponent(name)}`)
      : callLocal<void>('delete_worker_secret', { id, name }),

  // ── R2 ──────────────────────────────────────────────────────────────
  listR2Buckets: () =>
    isRemote()
      ? callRemote<T.R2Bucket[]>('GET', '/r2/buckets')
      : callLocal<T.R2Bucket[]>('list_r2_buckets'),
  createR2Bucket: (name: string) =>
    isRemote()
      ? callRemote<void>('POST', '/r2/buckets', { name })
      : callLocal<void>('create_r2_bucket', { name }),
  deleteR2Bucket: (name: string) =>
    isRemote()
      ? callRemote<void>('DELETE', `/r2/buckets/${encodeURIComponent(name)}`)
      : callLocal<void>('delete_r2_bucket', { name }),

  // ── Project file editor ─────────────────────────────────────────────
  listProjectFiles: (folder: string) =>
    isRemote()
      ? callRemote<string[]>('POST', '/projects/files/list', { folder })
      : callLocal<string[]>('list_project_files', { folder }),
  readProjectFile: (folder: string, rel: string) =>
    isRemote()
      ? callRemote<string>('POST', '/projects/files/read', { folder, rel })
      : callLocal<string>('read_project_file', { folder, rel }),
  writeProjectFile: (folder: string, rel: string, content: string) =>
    isRemote()
      ? callRemote<void>('PUT', '/projects/files/write', { folder, rel, content })
      : callLocal<void>('write_project_file', { folder, rel, content }),

  // ── Live tail ───────────────────────────────────────────────────────
  startProjectTail: (projectId: number) =>
    isRemote()
      ? callRemote<{ eventId: string }>('POST', `/projects/${projectId}/tail`).then((r) => r.eventId)
      : callLocal<string>('start_project_tail', { projectId }),
  stopProjectTail: (tailId: string) =>
    isRemote()
      ? callRemote<void>('POST', `/events/${encodeURIComponent(tailId)}/stop`)
      : callLocal<void>('stop_project_tail', { tailId }),

  // ── D1 ──────────────────────────────────────────────────────────────
  listD1Databases: () =>
    isRemote()
      ? callRemote<T.D1Database[]>('GET', '/d1/databases')
      : callLocal<T.D1Database[]>('list_d1_databases'),
  execD1: (uuid: string, sql: string) =>
    isRemote()
      ? callRemote<T.D1QueryResult>('POST', `/d1/databases/${encodeURIComponent(uuid)}/query`, { sql })
      : callLocal<T.D1QueryResult>('exec_d1', { uuid, sql }),
  deleteD1Database: (uuid: string) =>
    isRemote()
      ? callRemote<void>('DELETE', `/d1/databases/${encodeURIComponent(uuid)}`)
      : callLocal<void>('delete_d1_database', { uuid }),

  // ── DNS ─────────────────────────────────────────────────────────────
  listDnsRecords: (zoneId: string) =>
    isRemote()
      ? callRemote<T.DnsRecord[]>('GET', `/dns/zones/${encodeURIComponent(zoneId)}/records`)
      : callLocal<T.DnsRecord[]>('list_dns_records', { zoneId }),
  createDnsRecord: (zoneId: string, record: T.NewDnsRecord) =>
    isRemote()
      ? callRemote<T.DnsRecord>('POST', `/dns/zones/${encodeURIComponent(zoneId)}/records`, record)
      : callLocal<T.DnsRecord>('create_dns_record', { zoneId, record }),
  deleteDnsRecord: (zoneId: string, recordId: string) =>
    isRemote()
      ? callRemote<void>('DELETE', `/dns/zones/${encodeURIComponent(zoneId)}/records/${encodeURIComponent(recordId)}`)
      : callLocal<void>('delete_dns_record', { zoneId, recordId }),

  // ── Zone cache controls (purge + dev mode) ──────────────────────────
  purgeCache: (zoneId: string, files: string[] = []) =>
    isRemote()
      ? callRemote<void>('POST', `/zones/${encodeURIComponent(zoneId)}/purge-cache`, { files })
      : callLocal<void>('purge_cache', { zoneId, files }),
  setDevMode: (zoneId: string, on: boolean) =>
    isRemote()
      ? callRemote<void>('POST', `/zones/${encodeURIComponent(zoneId)}/dev-mode`, { on })
      : callLocal<void>('set_dev_mode', { zoneId, on }),
  getDevMode: (zoneId: string) =>
    isRemote()
      ? callRemote<{ on: boolean; expiresAt: number | null }>('GET', `/zones/${encodeURIComponent(zoneId)}/dev-mode`)
      : callLocal<{ on: boolean; expiresAt: number | null }>('get_dev_mode', { zoneId }),

  // ── Cloudflare Pages ────────────────────────────────────────────────
  listPagesProjects: () =>
    isRemote()
      ? callRemote<T.PagesProject[]>('GET', '/cf-pages/projects')
      : callLocal<T.PagesProject[]>('list_pages_projects'),
  listPagesDeployments: (project: string) =>
    isRemote()
      ? callRemote<T.PagesDeployment[]>('GET', `/cf-pages/projects/${encodeURIComponent(project)}/deployments`)
      : callLocal<T.PagesDeployment[]>('list_pages_deployments', { project }),

  // ── Project wizard ──────────────────────────────────────────────────
  listTemplates: () =>
    isRemote()
      ? callRemote<T.Template[]>('GET', '/projects/templates')
      : callLocal<T.Template[]>('list_templates'),
  listProjects: () =>
    isRemote()
      ? callRemote<T.Project[]>('GET', '/projects')
      : callLocal<T.Project[]>('list_projects'),
  deleteProject: (id: number) =>
    isRemote()
      ? callRemote<void>('DELETE', `/projects/${id}`)
      : callLocal<void>('delete_project', { id }),
  updateProjectLiveUrl: (id: number, deployedUrl: string | null, customDomain: string | null) =>
    isRemote()
      ? callRemote<T.Project>('PATCH', `/projects/${id}/live-url`, { deployedUrl, customDomain })
      : callLocal<T.Project>('update_project_live_url', { id, deployedUrl, customDomain }),
  startCreateProject: (spec: T.CreateSpec) =>
    isRemote()
      ? callRemote<{ eventId: string }>('POST', '/projects', spec).then((r) => r.eventId)
      : callLocal<string>('start_create_project', { spec }),
  redeployProject: (id: number) =>
    isRemote()
      ? callRemote<{ eventId: string }>('POST', `/projects/${id}/redeploy`).then((r) => r.eventId)
      : callLocal<string>('redeploy_project', { id }),
  inspectProjectFolder: (folder: string) =>
    isRemote()
      ? callRemote<T.FolderInspection>('POST', '/projects/inspect', { folder })
      : callLocal<T.FolderInspection>('inspect_project_folder', { folder }),
  scanWranglerProjects: (folder: string) =>
    isRemote()
      ? callRemote<T.FolderInspection[]>('POST', '/projects/scan', { folder })
      : callLocal<T.FolderInspection[]>('scan_wrangler_projects', { folder }),
  importProject: (spec: T.ImportSpec) =>
    isRemote()
      ? callRemote<T.Project>('POST', '/projects/import', spec)
      : callLocal<T.Project>('import_project', { spec }),

  // ── Setup ───────────────────────────────────────────────────────────
  detectSetup: () =>
    isRemote()
      ? callRemote<T.ToolStatus[]>('GET', '/setup/tools')
      : callLocal<T.ToolStatus[]>('detect_setup'),
  installTool: (toolId: string) =>
    isRemote()
      ? callRemote<{ eventId: string }>('POST', `/setup/tools/${encodeURIComponent(toolId)}/install`).then((r) => r.eventId)
      : callLocal<string>('install_tool', { toolId }),

  listMissingTools: () =>
    isRemote()
      ? callRemote<T.ToolStatus[]>('GET', '/setup/missing')
      : callLocal<T.ToolStatus[]>('list_missing_tools'),

  installAllTools: () =>
    isRemote()
      ? callRemote<{ eventId: string }>('POST', '/setup/install-all').then((r) => r.eventId)
      : callLocal<string>('install_all_tools'),

  stopProject: (id: number) =>
    isRemote()
      ? callRemote<T.Project>('POST', `/projects/${id}/stop`)
      : callLocal<T.Project>('stop_project', { id }),

  // Native shell ops. Remote: run on the server (no-op on headless Linux).
  openProjectFolder: (path: string) =>
    isRemote()
      ? callRemote<void>('POST', '/shell/open-folder', { path })
      : callLocal<void>('open_project_folder', { path }),

  // Always opens the folder on the LAPTOP (this PC) regardless of connection
  // mode. Used by the file mirror — the path is a local mirror folder,
  // not anything on the server.
  openLocalFolder: (path: string) =>
    callLocal<void>('open_project_folder', { path }),
  deleteProjectFolder: (folder: string) =>
    isRemote()
      ? callRemote<void>('POST', '/shell/delete-folder', { folder })
      : callLocal<void>('delete_project_folder', { folder }),
  openInEditor: (path: string) =>
    isRemote()
      ? callRemote<void>('POST', '/shell/open-editor', { path })
      : callLocal<void>('open_in_editor', { path }),
  httpRequest: (spec: T.HttpRequestSpec) =>
    isRemote()
      ? callRemote<T.HttpResponse>('POST', '/debug/http', spec)
      : callLocal<T.HttpResponse>('http_request', { spec }),
  pingUrl: (url: string) =>
    isRemote()
      ? callRemote<T.PingResult>('POST', '/debug/ping', { url })
      : callLocal<T.PingResult>('ping_url', { url }),

  // Folder picking. Local: native Tauri dialog. Remote: the UI shows a
  // RemoteFolderPicker modal that calls `browseFs` directly, so this
  // helper is only ever invoked in local mode.
  pickProjectFolder: () =>
    isRemote()
      ? Promise.resolve<string | null>(null)
      : callLocal<string | null>('pick_project_folder'),

  // Remote filesystem browser (also exposed in local mode for symmetry).
  browseFs: (path: string | null) =>
    isRemote()
      ? callRemote<T.BrowseResult>('GET', `/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`)
      : callLocal<T.BrowseResult>('browse_fs', { path }),

  // Remote-only helpers (no local equivalent — used only by ConnectionSection)
  remoteSystemHealth: (baseUrl: string) =>
    fetch(`${baseUrl}/system/health`).then((r) => r.json()) as Promise<{
      ok: boolean;
      version: string;
      paired: boolean;
    }>,

  remotePair: (baseUrl: string, code: string) =>
    fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    }).then(async (r) => {
      if (!r.ok) throw await r.json();
      return r.json() as Promise<{ token: string }>;
    }),

  // Pair from a code the user copies out of the connector's terminal.
  // The code is "<random-words>-<4-char-secret>". We split on the LAST
  // dash so the subdomain (which itself contains dashes) is preserved.
  pairFromCode: async (rawCode: string) => {
    const trimmed = rawCode.trim();
    const lastDash = trimmed.lastIndexOf('-');
    if (lastDash < 0 || lastDash === trimmed.length - 1) {
      throw new Error('Invalid code. Copy the full string from the connector window.');
    }
    const subdomain = trimmed.slice(0, lastDash);
    const secret = trimmed.slice(lastDash + 1);
    const baseUrl = `https://${subdomain}.trycloudflare.com`;

    // 1. Reach the connector + fetch the bearer token via the code-gated
    //    handshake endpoint.
    const health = await fetch(`${baseUrl}/system/health`).then((r) => r.json());
    if (!health?.ok) throw new Error('Connector not reachable at ' + baseUrl);

    const hs = await fetch(`${baseUrl}/pair/handshake/${encodeURIComponent(secret)}`);
    if (!hs.ok) {
      throw new Error('Handshake rejected — code may be wrong, expired, or already used.');
    }
    const { token } = (await hs.json()) as { token: string };

    return { baseUrl, token };
  },

  // After pair succeeds, push the laptop's saved CF credentials to the
  // connector so the same account works on both ends. Best-effort — pairing
  // itself succeeds even if this fails (e.g. no creds saved yet).
  pushCredentialsToConnector: pushCredentialsToServer,
};

// Internal helper used by both the post-pair sync and any later credential
// rewrite (so the server keyring stays in step with the laptop's).
async function pushCredentialsToServer(): Promise<void> {
  const { remote } = getConnection();
  if (!remote) return;
  const [apiToken, gk] = await Promise.all([
    callLocal<string | null>('get_api_token').catch(() => null),
    callLocal<[string, string] | null>('get_global_key').catch(() => null),
  ]);
  const body: { apiToken?: string; globalEmail?: string; globalKey?: string } = {};
  if (apiToken) body.apiToken = apiToken;
  if (gk) { body.globalEmail = gk[0]; body.globalKey = gk[1]; }
  if (Object.keys(body).length === 0) return;
  await fetch(`${remote.baseUrl}/credentials/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${remote.token}` },
    body: JSON.stringify(body),
  });
}
