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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

  routeDns: (uuid: string, hostname: string, overwrite = false) =>
    isRemote()
      ? callRemote<void>('POST', `/tunnels/${uuid}/route-dns`, { hostname, overwrite })
      : callLocal<void>('route_dns', { uuid, hostname, overwrite }),

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

  setApiToken: (token: string) =>
    isRemote()
      ? callRemote<void>('POST', '/secrets/api-token', { token })
      : callLocal<void>('set_api_token', { token }),

  clearApiToken: () =>
    isRemote()
      ? callRemote<void>('DELETE', '/secrets/api-token')
      : callLocal<void>('clear_api_token'),

  hasApiToken: () =>
    isRemote()
      ? callRemote<boolean>('GET', '/secrets/api-token/exists')
      : callLocal<boolean>('has_api_token'),

  getApiToken: () =>
    isRemote()
      ? callRemote<string | null>('GET', '/secrets/api-token')
      : callLocal<string | null>('get_api_token'),

  verifyApiToken: () =>
    isRemote()
      ? callRemote<void>('POST', '/secrets/api-token/verify')
      : callLocal<void>('verify_api_token'),

  listZones: () =>
    isRemote()
      ? callRemote<T.Zone[]>('GET', '/zones')
      : callLocal<T.Zone[]>('list_zones'),

  setGlobalKey: (email: string, key: string) =>
    isRemote()
      ? callRemote<void>('POST', '/secrets/global-key', { email, key })
      : callLocal<void>('set_global_key', { email, key }),

  clearGlobalKey: () =>
    isRemote()
      ? callRemote<void>('DELETE', '/secrets/global-key')
      : callLocal<void>('clear_global_key'),

  hasGlobalKey: () =>
    isRemote()
      ? callRemote<boolean>('GET', '/secrets/global-key/exists')
      : callLocal<boolean>('has_global_key'),

  getGlobalKey: () =>
    isRemote()
      ? callRemote<[string, string] | null>('GET', '/secrets/global-key')
      : callLocal<[string, string] | null>('get_global_key'),

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
};
