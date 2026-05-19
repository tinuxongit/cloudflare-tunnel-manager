import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type * as T from './types';

async function call<R>(cmd: string, args?: Record<string, unknown>): Promise<R> {
  try {
    return await tauriInvoke<R>(cmd, args);
  } catch (e) {
    throw e as T.AppError;
  }
}

export const api = {
  listPages:           () => call<T.Page[]>('list_pages'),
  createPage:          (input: T.NewPageInput) => call<T.Page>('create_page', { input }),
  updatePage:          (id: number, patch: T.PagePatch) => call<T.Page>('update_page', { id, patch }),
  deletePage:          (id: number) => call<void>('delete_page', { id }),
  togglePage:          (id: number, on: boolean) => call<T.Page>('toggle_page', { id, on }),

  listTunnels:         () => call<T.Tunnel[]>('list_tunnels'),
  createTunnel:        (name: string) => call<T.Tunnel>('create_tunnel', { name }),
  deleteTunnel:        (uuid: string) => call<void>('delete_tunnel', { uuid }),
  routeDns:            (uuid: string, hostname: string) => call<void>('route_dns', { uuid, hostname }),

  getStatus:           (tunnel_uuid: string) => call<T.RuntimeStatus>('get_status', { tunnelUuid: tunnel_uuid }),
  getLogs:             (tunnel_uuid: string, last_n = 500) => call<T.LogLine[]>('get_logs', { tunnelUuid: tunnel_uuid, lastN: last_n }),
  stopTunnel:          (uuid: string) => call<void>('stop_tunnel', { uuid }),
  startOrRestartForPage: (page_id: number) => call<void>('start_or_restart_for_page', { pageId: page_id }),

  checkLocalService:   (url: string) => call<T.ServiceHealth>('check_local_service', { url }),
  cloudflaredInfo:     () => call<T.CloudflaredInfo>('cloudflared_info'),

  getSettings:         () => call<T.Settings>('get_settings'),
  setSettings:         (patch: T.SettingsPatch) => call<T.Settings>('set_settings', { patch }),

  // Cloudflare API token + zones
  setApiToken:         (token: string) => call<void>('set_api_token', { token }),
  clearApiToken:       () => call<void>('clear_api_token'),
  hasApiToken:         () => call<boolean>('has_api_token'),
  getApiToken:         () => call<string | null>('get_api_token'),
  verifyApiToken:      () => call<void>('verify_api_token'),
  listZones:           () => call<T.Zone[]>('list_zones'),
};
