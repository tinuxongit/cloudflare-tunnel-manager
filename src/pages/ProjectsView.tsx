import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/ipc';
import { useStore } from '@/lib/store';
import { getConnection } from '@/lib/connection';
import { streamProjectProgress, type Stop } from '@/lib/events';
import type { Project, Template, CreateSpec, ProjectProgress, FolderInspection } from '@/lib/types';
import { TokenGate } from '@/components/TokenGate';
import { ApiTester } from '@/components/ApiTester';
import { TailViewer } from '@/components/TailViewer';
import { RemoteFolderPicker } from '@/components/RemoteFolderPicker';
import { ProjectEditor } from './ProjectEditor';
import { useDeployTerminal } from '@/lib/deployTerminal';
import { Loading, Empty, ErrorBox } from '@/components/ListState';
import { PageShell, PageHeader } from '@/components/PageShell';
import { useConfirm } from '@/components/ConfirmDialog';

export function ProjectsView() {
  const { hasToken } = useStore();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  const projectsTick = useStore((s) => s.projectsTick);
  useEffect(() => { load(); }, [projectsTick]);

  async function load() {
    setErr(null);
    try { setProjects(await api.listProjects()); }
    catch (e: any) { setErr(e?.message ?? String(e)); setProjects([]); }
  }

  if (!hasToken) return <TokenGate label="Projects" />;
  if (editing) return <div className="h-full"><ProjectEditor project={editing} onClose={() => setEditing(null)} onChange={load} /></div>;

  return (
    <PageShell>
      <PageHeader title="Projects"
        subtitle="Deploy, test and manage your Cloudflare Workers."
        actions={
          <>
            <button onClick={load} className="h-9 text-xs px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition">
              Refresh
            </button>
            <button onClick={() => setImportOpen(true)}
              className="h-9 border border-border-strong rounded-md px-4 text-xs font-semibold text-fg-muted hover:text-fg hover:bg-bg-elev transition">
              + Import existing
            </button>
            <button onClick={() => setWizardOpen(true)}
              className="h-9 bg-gradient-to-b from-zinc-50 to-zinc-300 text-bg rounded-md px-4 text-xs font-semibold shadow-[0_1px_0_rgba(255,255,255,0.35)_inset]">
              + New project
            </button>
          </>
        } />

      {err && <ErrorBox text={err} />}

      {!projects ? <Loading label="Loading projects…" /> :
        projects.length === 0 ? (
          <Empty label="No projects yet." hint='Click "+ New project" to create your first one — Worker + database, plain Worker, or static site.' />
        ) : (
          <section className="space-y-3">
            <div className="text-sm text-fg-muted">{projects.length} project{projects.length === 1 ? '' : 's'}</div>
            {projects.map(p => <ProjectCard key={p.id} p={p} onChange={load} onEdit={() => setEditing(p)} />)}
          </section>
        )}

      {wizardOpen && <NewProjectWizard onClose={() => setWizardOpen(false)} onCreated={() => { setWizardOpen(false); load(); }} />}
      {importOpen && <ImportProjectDialog onClose={() => setImportOpen(false)} onImported={() => { setImportOpen(false); load(); }} />}
    </PageShell>
  );
}

function ImportProjectDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { hasToken, zones, refreshZones } = useStore();
  const [pickedFolder, setPickedFolder] = useState('');         // what the user browsed to (may be an ancestor)
  const [candidates, setCandidates] = useState<FolderInspection[] | null>(null);
  const [inspection, setInspection] = useState<FolderInspection | null>(null);  // the one being imported
  const [name, setName] = useState('');
  const [detectedUrl, setDetectedUrl] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [manualHost, setManualHost] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const composedHost = zoneName === '__free__'
    ? manualHost.trim()
    : (subdomain.trim() && zoneName ? `${subdomain.trim()}.${zoneName}` : '');
  const customLive = normalizeLiveUrl(composedHost);
  const fallbackLive = normalizeLiveUrl(detectedUrl);
  const livePreview = customLive.url ?? fallbackLive.url;

  useEffect(() => {
    if (hasToken && zones.length === 0) refreshZones();
  }, [hasToken, zones.length, refreshZones]);

  async function pick() {
    // Remote mode → show the connector's filesystem browser. Local → native
    // Tauri folder dialog. Both feed into the same scan-and-import flow.
    if (getConnection().mode === 'remote') {
      setPickerOpen(true);
      return;
    }
    try {
      const p = await api.pickProjectFolder();
      if (!p) return;
      await handlePicked(p);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  async function handlePicked(p: string) {
    setPickedFolder(p);
    setCandidates(null); setInspection(null); setErr(null);
    setScanning(true);
    try {
      const found = await api.scanWranglerProjects(p);
      setCandidates(found);
      if (found.length === 1) selectCandidate(found[0]);
      else if (found.length === 0) setErr("No wrangler.toml found in this folder or any subfolders. Pick a folder that contains a Cloudflare Worker / Pages project.");
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setScanning(false); }
  }

  function selectCandidate(c: FolderInspection) {
    setInspection(c);
    if (c.name) setName(c.name);
    setDetectedUrl(c.currentDeployedUrl ?? '');
    setSubdomain('');
    setZoneName('');
    setManualHost('');
  }

  async function submit() {
    if (!inspection || !inspection.valid || !name.trim()) return;
    setBusy(true); setErr(null);
    try {
      const deployedUrl = customLive.url ?? fallbackLive.url;
      const customDomain = customLive.host;
      await api.importProject({
        folder: inspection.folder,
        name: name.trim(),
        templateId: inspection.templateGuess,
        deployedUrl,
        customDomain,
      });
      onImported();
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg border border-border-strong rounded-lg w-[560px] max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Import existing project</h2>
            <p className="text-[11px] text-fg-dim mt-0.5">Point at a folder with a wrangler.toml. Existing deployment + database untouched.</p>
          </div>
          <button onClick={onClose} className="text-fg-muted hover:text-fg text-lg">×</button>
        </header>
        <div className="p-6 space-y-4">
          <div className="space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-fg-muted font-semibold">Folder</span>
            <div className="flex gap-2">
              <input value={pickedFolder} readOnly placeholder="(click Browse — picks any ancestor; subfolders are scanned automatically)"
                className="flex-1 bg-bg-elev border border-border rounded px-3 py-2 font-mono text-sm text-fg-muted" />
              <button onClick={pick} className="px-3 py-2 border border-border rounded text-xs text-fg-muted hover:text-fg">
                Browse…
              </button>
            </div>
            {scanning && <div className="text-[11px] text-fg-dim font-mono">Scanning…</div>}
          </div>

          {candidates && candidates.length > 1 && !inspection && (
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-fg-muted font-semibold">
                Found {candidates.length} projects — pick one
              </div>
              {candidates.map(c => (
                <button key={c.folder} onClick={() => selectCandidate(c)}
                  className="w-full text-left bg-bg-elev border border-border hover:border-fg rounded p-3">
                  <div className="font-mono text-sm text-fg">{c.name ?? '(no name)'}</div>
                  <div className="text-[11px] text-fg-dim font-mono mt-0.5 truncate" title={c.folder}>{c.folder}</div>
                  <div className="text-[10px] text-fg-faint font-mono mt-1 uppercase tracking-wider">
                    {c.kind}{c.hasD1 && ' · d1'}{c.hasR2 && ' · r2'}
                  </div>
                </button>
              ))}
            </div>
          )}

          {inspection && !inspection.valid && (
            <div className="text-[11px] font-mono text-red-300 bg-red-950/20 border border-red-900/50 rounded p-3">
              {inspection.reason}
            </div>
          )}

          {inspection && inspection.valid && (
            <>
              <div className="text-[11px] font-mono text-fg-dim">
                Importing: <span className="text-fg">{inspection.folder}</span>
                {candidates && candidates.length > 1 && (
                  <button onClick={() => setInspection(null)} className="ml-2 text-fg-muted hover:text-fg underline">
                    pick a different one
                  </button>
                )}
              </div>
              <div className="bg-bg-elev border border-border rounded p-3 text-[11px] font-mono space-y-1">
                <Detected k="Type" v={inspection.kind} />
                <Detected k="D1 database" v={inspection.hasD1 ? 'yes' : 'no'} />
                <Detected k="R2 bucket" v={inspection.hasR2 ? 'yes' : 'no'} />
                <Detected k="Will use template" v={inspection.templateGuess} />
              </div>

              <Field label="Project name" hint="Must match the `name` in wrangler.toml so deploy + tail work.">
                <input value={name} onChange={e => setName(e.target.value)} spellCheck={false}
                  className="w-full bg-bg-elev border border-border rounded px-3 py-2 font-mono text-sm" />
              </Field>

              <Field label="Live URL (optional)"
                hint={zones.length > 0
                  ? "Pick one of your Cloudflare domains, or choose other to type a full host. The detected workers.dev URL is only used if this is blank."
                  : "No zones loaded - make sure your API token has Zone:Read. You can still type a full host manually."}>
                {zones.length > 0 && zoneName !== '__free__' ? (
                  <div className="flex gap-1 items-stretch">
                    <input
                      value={subdomain}
                      onChange={e => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                      spellCheck={false}
                      placeholder="licenses"
                      className="flex-1 bg-bg-elev border border-border rounded px-3 py-2 font-mono text-sm" />
                    <span className="text-fg-muted self-center px-1 font-mono text-sm">.</span>
                    <select
                      value={zoneName}
                      onChange={e => setZoneName(e.target.value)}
                      className="bg-bg-elev border border-border rounded px-3 py-2 font-mono text-sm min-w-[180px]">
                      <option value="">- use detected URL -</option>
                      {zones.map(z => <option key={z.id} value={z.name}>{z.name}</option>)}
                      <option value="__free__">(other / type manually)</option>
                    </select>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <input
                      value={manualHost}
                      onChange={e => setManualHost(e.target.value)}
                      spellCheck={false}
                      placeholder="licenses.example.com"
                      className="w-full bg-bg-elev border border-border rounded px-3 py-2 font-mono text-sm" />
                    {zones.length > 0 && (
                      <button
                        type="button"
                        onClick={() => { setZoneName(''); setManualHost(''); }}
                        className="text-[11px] text-fg-muted hover:text-fg">
                        back to zone picker
                      </button>
                    )}
                  </div>
                )}
                {detectedUrl && (
                  <div className="text-[11px] text-fg-dim font-mono pt-1">
                    Detected: <span className="text-fg-muted">{fallbackLive.url ?? detectedUrl}</span>
                  </div>
                )}
                {livePreview && (
                  <div className="text-[11px] text-fg-dim font-mono pt-1">
                    -&gt; <span className="text-fg">{livePreview}</span>
                  </div>
                )}
              </Field>
            </>
          )}

          {err && <div className="text-[11px] font-mono text-red-300 bg-red-950/20 border border-red-900/50 rounded p-3">{err}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-fg-muted hover:text-fg">Cancel</button>
            <button onClick={submit} disabled={!inspection?.valid || !name.trim() || busy}
              className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded px-4 py-1.5 text-xs font-semibold disabled:opacity-40">
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      </div>
      {pickerOpen && (
        <RemoteFolderPicker
          title="Pick a folder on the remote server"
          initialPath={pickedFolder || null}
          onClose={() => setPickerOpen(false)}
          onPick={(p) => { setPickerOpen(false); handlePicked(p).catch(() => {}); }}
        />
      )}
    </div>
  );
}

function Detected({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-fg-dim">{k}</span>
      <span className="text-fg">{v}</span>
    </div>
  );
}

function DetailRow({ label, value, valueClassName = 'text-fg' }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-4 items-start">
      <span className="text-fg-muted">{label}</span>
      <span className={`${valueClassName} break-all`}>{value}</span>
    </div>
  );
}

function InfoPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 bg-bg border border-border-strong rounded-md p-3 font-mono text-[12px]">
      <div className="flex items-center justify-between gap-4">
        <span className="text-fg-muted">{label}</span>
        <span className="text-fg-muted break-all text-right">{value}</span>
      </div>
    </div>
  );
}

function normalizeLiveUrl(raw: string): { url: string | null; host: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { url: null, host: null };
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    const host = url.host.toLowerCase();
    if (!host) return { url: null, host: null };
    url.hash = '';
    return { url: url.toString().replace(/\/$/, ''), host };
  } catch {
    const host = trimmed.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    return host ? { url: `https://${host}`, host } : { url: null, host: null };
  }
}

function customDomainForHost(host: string | null): string | null {
  if (!host || host.endsWith('.workers.dev')) return null;
  return host;
}

type Liveness = 'unknown' | 'checking' | 'live' | 'unreachable' | 'stopped';

function ProjectCard({ p, onChange, onEdit }: { p: Project; onChange: () => void; onEdit: () => void }) {
  const startDeployTerminal = useDeployTerminal((s) => s.start);
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [testerOpen, setTesterOpen] = useState(false);
  const [tailOpen, setTailOpen] = useState(false);
  const [liveEditorOpen, setLiveEditorOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const effectiveUrl = p.deployedUrl
    ? (p.customDomain?.trim() ? normalizeLiveUrl(p.customDomain).url : p.deployedUrl)
    : null;
  const [liveness, setLiveness] = useState<Liveness>(effectiveUrl ? 'checking' : 'stopped');
  const [pingStatus, setPingStatus] = useState<number | null>(null);

  // Verify the URL on mount + every time deployedUrl changes. Cheap GET with
  // a 5s timeout. Without this, an imported card always shows "live" even
  // if the URL doesn't actually respond.
  useEffect(() => {
    let cancelled = false;
    if (!effectiveUrl) { setLiveness('stopped'); setPingStatus(null); return; }
    setLiveness('checking');
    api.pingUrl(effectiveUrl).then((r) => {
      if (cancelled) return;
      setPingStatus(r.status);
      setLiveness(r.alive ? 'live' : 'unreachable');
    }).catch(() => { if (!cancelled) setLiveness('unreachable'); });
    return () => { cancelled = true; };
  }, [effectiveUrl]);

  // Buttons that need a URL show when one is configured. The badge reflects
  // whether that URL actually responds; we don't disable buttons on the
  // unreachable state so the user can investigate via Test API / Live logs.
  const hasUrl = !!effectiveUrl;

  async function redeploy() {
    setBusy(true);
    try {
      const eventId = await api.redeployProject(p.id);
      await startDeployTerminal(`Deploying ${p.name}`, eventId, () => {
        // Refresh when the deploy actually finishes — not on a guess-timer —
        // so the card flips from "stopped" → "live" with the fresh URL.
        setBusy(false);
        onChange();
      });
    } catch (e: any) {
      alert(e?.message ?? String(e));
      setBusy(false);
    }
  }

  async function del() {
    const ok = await confirm({
      title: `Remove "${p.name}" from this list?`,
      message: 'The folder on disk + the deployed Worker are NOT touched. Use Stop if you want to take the Worker offline too.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try { await api.deleteProject(p.id); onChange(); } catch {}
  }

  async function stop() {
    const ok = await confirm({
      title: `Stop "${p.name}"?`,
      message: 'The Worker on Cloudflare gets deleted (URL stops responding). Your code, database, and project card all stay — click Deploy to bring it back any time.',
      variant: 'danger',
      confirmLabel: 'Stop Worker',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.stopProject(p.id);
      onChange();
    } catch (e: any) { alert(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  async function reveal() {
    try { await api.openProjectFolder(p.folder); } catch {}
  }

  async function edit() {
    try { await api.openInEditor(p.folder); } catch {}
  }

  return (
    <div className="group bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.01))] border border-border-strong rounded-md p-4 space-y-3 shadow-[0_18px_60px_rgba(0,0,0,0.22)] hover:border-zinc-600/70 transition">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-base font-semibold text-fg tracking-tight">{p.name}</span>
            <LivenessBadge state={liveness} status={pingStatus} />
            {hasUrl && (
              <button onClick={stop} disabled={busy}
                title="Stop — delete the Worker on Cloudflare. Folder + DB stay. Click Deploy to bring it back."
                className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-0.5 rounded-full text-red-300 bg-red-500/10 border border-red-500/30 hover:text-red-200 hover:bg-red-500/20 hover:border-red-500/50 transition disabled:opacity-40">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="5" y="5" width="14" height="14" rx="2" />
                </svg>
                Stop
              </button>
            )}
          </div>
          <div className="text-[11px] text-fg-dim font-mono mt-1">{p.templateId} <span className="text-fg-faint">·</span> {p.folder}</div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button onClick={onEdit} className="h-9 text-[11px] px-3 bg-gradient-to-b from-zinc-700/35 to-zinc-900/45 border border-zinc-700/70 rounded text-fg hover:border-zinc-500 transition">
            Edit code
          </button>
          {hasUrl && (
            <button onClick={() => setTesterOpen(true)} className="h-9 text-[11px] px-3 border border-border-strong rounded text-fg-muted hover:text-fg hover:bg-bg-elev transition">
              Test API
            </button>
          )}
          {hasUrl && (
            <button onClick={() => setTailOpen(true)} className="h-9 text-[11px] px-3 border border-border-strong rounded text-fg-muted hover:text-fg hover:bg-bg-elev transition">
              Live logs
            </button>
          )}
          <button onClick={redeploy} disabled={busy}
            className="h-9 text-[11px] px-3 bg-gradient-to-b from-zinc-50 to-zinc-300 text-bg rounded font-semibold disabled:opacity-40 shadow-[0_1px_0_rgba(255,255,255,0.35)_inset]">
            {busy ? 'Deploying…' : hasUrl ? 'Redeploy' : 'Deploy'}
          </button>
          <OverflowMenu
            onEditLiveUrl={() => setLiveEditorOpen(true)}
            onExternalEditor={edit}
            onOpenFolder={reveal}
            onPurge={() => setPurgeOpen(true)}
            onRemove={del}
          />
        </div>
      </div>
      {effectiveUrl && (
        <div className="text-[11px] font-mono flex items-center gap-2">
          <span className="text-fg-dim">Live:</span>
          <a href={effectiveUrl} target="_blank" rel="noreferrer" className="text-blue-200 hover:text-blue-100 hover:underline break-all">{effectiveUrl}</a>
        </div>
      )}
      {testerOpen && effectiveUrl && (
        <ApiTesterModal url={effectiveUrl} name={p.name} onClose={() => setTesterOpen(false)} />
      )}
      {tailOpen && (
        <TailViewer projectId={p.id} projectName={p.name} onClose={() => setTailOpen(false)} />
      )}
      {liveEditorOpen && (
        <EditLiveUrlDialog
          project={p}
          effectiveUrl={effectiveUrl}
          onClose={() => setLiveEditorOpen(false)}
          onSaved={() => { setLiveEditorOpen(false); onChange(); }}
        />
      )}
      {purgeOpen && (
        <PurgeProjectDialog
          project={p}
          onClose={() => setPurgeOpen(false)}
          onDeleted={() => { setPurgeOpen(false); onChange(); }}
        />
      )}
    </div>
  );
}

function EditLiveUrlDialog({
  project,
  effectiveUrl,
  onClose,
  onSaved,
}: {
  project: Project;
  effectiveUrl: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { hasToken, zones, refreshZones } = useStore();
  const detectedUrl = effectiveUrl && !project.customDomain ? effectiveUrl : null;
  const initialHost = customDomainForHost(normalizeLiveUrl(project.customDomain || '').host) ?? '';
  const initialMatch = splitHostByZone(initialHost, zones);
  const [subdomain, setSubdomain] = useState(initialMatch?.subdomain ?? '');
  const [zoneName, setZoneName] = useState(initialMatch?.zoneName ?? (initialHost && zones.length === 0 ? '__free__' : ''));
  const [manualHost, setManualHost] = useState(initialMatch ? '' : initialHost);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (hasToken && zones.length === 0) refreshZones();
  }, [hasToken, zones.length, refreshZones]);

  useEffect(() => {
    if (!initialHost || zoneName || zones.length === 0) return;
    const match = splitHostByZone(initialHost, zones);
    if (match) {
      setSubdomain(match.subdomain);
      setZoneName(match.zoneName);
      setManualHost('');
    }
  }, [initialHost, zoneName, zones]);

  const composedHost = zoneName === '__free__'
    ? manualHost.trim()
    : (subdomain.trim() && zoneName ? `${subdomain.trim()}.${zoneName}` : '');
  const normalized = normalizeLiveUrl(composedHost);
  const previewUrl = normalized.url;
  const canSave = !!previewUrl && !busy;

  async function save() {
    if (!previewUrl) return;
    setBusy(true); setErr(null);
    try {
      await api.updateProjectLiveUrl(project.id, previewUrl, customDomainForHost(normalized.host));
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true); setErr(null);
    try {
      await api.updateProjectLiveUrl(project.id, null, null);
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[linear-gradient(180deg,#111217,#0b0c10)] border border-zinc-700/70 rounded-md w-[640px] max-h-[85vh] overflow-auto shadow-[0_28px_120px_rgba(0,0,0,0.65)]" onClick={e => e.stopPropagation()}>
        <header className="px-6 pt-6 pb-4 flex items-start justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="h-8 w-8 rounded-full border border-zinc-600 bg-bg-elev flex items-center justify-center text-fg-muted">
                <IconGlobe />
              </span>
              <h2 className="text-lg font-semibold tracking-tight">Edit live URL</h2>
            </div>
            <p className="text-sm text-fg-muted">Choose the public URL where this project is reachable.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="h-8 w-8 flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition">
            <IconX />
          </button>
        </header>
        <div className="px-6 pb-6 space-y-4">
          <div className="bg-bg/80 border border-border-strong rounded-md p-4 text-[12px] font-mono space-y-3">
            <DetailRow label="Current URL" value={effectiveUrl ?? 'not set'} valueClassName="text-blue-200" />
            <DetailRow label="Folder" value={project.folder} />
          </div>

          <Field label="Live URL"
            hint={zones.length > 0
              ? "Pick one of your Cloudflare domains, or choose other to type a full host."
              : "No zones loaded — make sure your API token has Zone:Read. You can still type a full host manually."}>
            {zones.length > 0 && zoneName !== '__free__' ? (
              <div className="flex gap-2 items-stretch">
                <input
                  value={subdomain}
                  onChange={e => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  spellCheck={false}
                  autoFocus
                  placeholder="licenses"
                  className="flex-1 bg-bg border border-orange-700/75 rounded-md px-3 py-2.5 font-mono text-sm text-fg shadow-[0_0_0_1px_rgba(249,115,22,0.12)]" />
                <span className="text-fg-muted self-center font-mono text-sm">.</span>
                <select
                  value={zoneName}
                  onChange={e => setZoneName(e.target.value)}
                  className="bg-bg border border-orange-700/75 rounded-md px-3 py-2.5 font-mono text-sm min-w-[220px] text-fg shadow-[0_0_0_1px_rgba(249,115,22,0.12)]">
                  <option value="">Select a domain</option>
                  {zones.map(z => <option key={z.id} value={z.name}>{z.name}</option>)}
                </select>
              </div>
            ) : (
              <div className="space-y-1">
                <input
                  value={manualHost}
                  onChange={e => setManualHost(e.target.value)}
                  spellCheck={false}
                  autoFocus
                  placeholder="licenses.example.com"
                  className="w-full bg-bg border border-orange-700/75 rounded-md px-3 py-2.5 font-mono text-sm text-fg shadow-[0_0_0_1px_rgba(249,115,22,0.12)]" />
                {zones.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setZoneName(''); setManualHost(''); }}
                    className="w-full mt-2 flex items-center gap-2 bg-bg border border-border-strong rounded-md px-3 py-2.5 text-sm text-fg-muted hover:text-fg hover:border-zinc-600 transition">
                    <IconChevronLeft />
                    Back to domain picker
                  </button>
                )}
              </div>
            )}
            {zones.length > 0 && zoneName !== '__free__' && (
              <button
                type="button"
                onClick={() => { setZoneName('__free__'); setManualHost(''); }}
                className="w-full mt-3 flex items-center justify-between bg-bg border border-border-strong rounded-md px-3 py-2.5 text-sm text-fg-muted hover:text-fg hover:border-zinc-600 transition">
                <span className="inline-flex items-center gap-2"><IconGlobe /> Other — type manually</span>
                <IconChevronRight />
              </button>
            )}
            {detectedUrl && (
              <InfoPanel label="Detected fallback" value={detectedUrl} />
            )}
            {previewUrl && (
              <div className="mt-3 bg-bg border border-border-strong rounded-md p-3">
                <div className="flex items-center justify-between gap-4 font-mono text-[12px]">
                  <span className="text-fg-muted">Live preview</span>
                  <span className="text-green-300 break-all text-right">{previewUrl}</span>
                </div>
                <div className="text-[11px] text-fg-dim mt-2">This is the URL that will be saved for this project.</div>
              </div>
            )}
          </Field>

          {err && <div className="text-[11px] font-mono text-red-300 bg-red-950/20 border border-red-900/50 rounded p-3">{err}</div>}

          <div className="flex justify-between gap-2 pt-2">
            <button onClick={clear} disabled={busy}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium rounded-md text-red-300 bg-red-500/10 border border-red-500/30 hover:text-red-200 hover:bg-red-500/20 hover:border-red-500/50 transition disabled:opacity-40">
              <IconTrash />
              Clear URL
            </button>
            <div className="flex gap-2">
              <button onClick={onClose} className="h-9 px-4 text-xs border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition">Cancel</button>
              <button onClick={save} disabled={!canSave}
                className="h-9 bg-gradient-to-b from-zinc-50 to-zinc-300 text-bg rounded-md px-4 text-xs font-semibold disabled:opacity-40 shadow-[0_1px_0_rgba(255,255,255,0.35)_inset]">
                {busy ? 'Saving…' : 'Save live URL'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Purge dialog ─────────────────────────────────────────────────────────

type PurgeItem =
  | { kind: 'worker';  id: string;                          label: string; sublabel?: string }
  | { kind: 'd1';      id: string; /* uuid */               label: string; sublabel?: string }
  | { kind: 'r2';      id: string; /* bucket name */        label: string; sublabel?: string }
  | { kind: 'dns';     id: string; /* record id */ zoneId: string; label: string; sublabel?: string }
  | { kind: 'folder';  id: string; /* path */               label: string; sublabel?: string };

type PurgeLog = { ts: number; text: string; tone: 'info' | 'ok' | 'err' };

function PurgeProjectDialog({
  project, onClose, onDeleted,
}: {
  project: Project;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { zones } = useStore();
  const [discovering, setDiscovering] = useState(true);
  const [items, setItems] = useState<PurgeItem[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [removeFromList, setRemoveFromList] = useState(true);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<PurgeLog[]>([]);
  const [done, setDone] = useState(false);

  function key(i: PurgeItem) { return `${i.kind}:${i.id}`; }
  function add(line: string, tone: PurgeLog['tone'] = 'info') {
    setLogs(s => [...s, { ts: Date.now(), text: line, tone }]);
  }

  // Discover deletable resources on mount. We name-match: the scaffold creates
  // D1 / R2 / Worker all under project.name, so we look those up directly. For
  // DNS we find the zone matching the custom domain (longest suffix wins).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found: PurgeItem[] = [];
      // Worker — only meaningful if currently deployed.
      if (project.deployedUrl) {
        found.push({ kind: 'worker', id: project.name, label: `Worker: ${project.name}`, sublabel: 'Deletes the deployed Worker on Cloudflare.' });
      }
      // D1
      try {
        const dbs = await api.listD1Databases();
        const match = dbs.find(d => d.name === project.name);
        if (match) found.push({ kind: 'd1', id: match.uuid, label: `D1: ${match.name}`, sublabel: `uuid ${match.uuid} · all data lost` });
      } catch {}
      // R2
      try {
        const buckets = await api.listR2Buckets();
        const match = buckets.find(b => b.name === project.name);
        if (match) found.push({ kind: 'r2', id: match.name, label: `R2: ${match.name}`, sublabel: 'Bucket + all objects deleted' });
      } catch {}
      // DNS — only if project has a custom domain
      const host = project.customDomain?.trim();
      if (host) {
        const zone = [...zones].sort((a, b) => b.name.length - a.name.length).find(z => host === z.name || host.endsWith(`.${z.name}`));
        if (zone) {
          try {
            const records = await api.listDnsRecords(zone.id);
            for (const r of records) {
              if (r.name.toLowerCase() === host.toLowerCase()) {
                found.push({ kind: 'dns', id: r.id, zoneId: zone.id, label: `DNS: ${r.type} ${r.name}`, sublabel: `→ ${r.content}` });
              }
            }
          } catch {}
        }
      }
      // Folder — always available (user opts in)
      found.push({ kind: 'folder', id: project.folder, label: 'Local folder', sublabel: project.folder });

      if (cancelled) return;
      setItems(found);
      // Default-on everything EXCEPT the folder (most destructive).
      setPicked(new Set(found.filter(i => i.kind !== 'folder').map(key)));
      setDiscovering(false);
    })();
    return () => { cancelled = true; };
  }, [project.id]);

  function toggle(i: PurgeItem) {
    setPicked(s => {
      const next = new Set(s);
      const k = key(i);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  async function run() {
    setRunning(true); setLogs([]); setDone(false);
    let hadError = false;
    const selected = items.filter(i => picked.has(key(i)));
    add(`Starting deletion of ${selected.length} resource${selected.length === 1 ? '' : 's'} for "${project.name}".`);
    for (const it of selected) {
      const label = it.label;
      try {
        add(`Deleting ${label}…`);
        switch (it.kind) {
          case 'worker': await api.stopProject(project.id); break;
          case 'd1':     await api.deleteD1Database(it.id); break;
          case 'r2':     await api.deleteR2Bucket(it.id); break;
          case 'dns':    await api.deleteDnsRecord(it.zoneId, it.id); break;
          case 'folder': await api.deleteProjectFolder(it.id); break;
        }
        add(`✓ ${label}`, 'ok');
      } catch (e: any) {
        add(`✗ ${label}: ${e?.message ?? String(e)}`, 'err');
        hadError = true;
      }
    }
    if (removeFromList) {
      try {
        add('Removing from project list…');
        await api.deleteProject(project.id);
        add('✓ Removed from project list', 'ok');
      } catch (e: any) {
        add(`✗ Remove from list: ${e?.message ?? String(e)}`, 'err');
        hadError = true;
      }
    }
    add('Done.', 'ok');
    setRunning(false); setDone(true);
    // If everything succeeded, close + refresh after a brief beat so the user
    // sees the final state. On errors, stay open so the log can be read.
    if (!hadError) setTimeout(onDeleted, 700);
  }

  const selectedCount = items.filter(i => picked.has(key(i))).length;
  const canRun = !running && !done && (selectedCount > 0 || removeFromList);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={running ? undefined : onClose}>
      <div className="bg-[linear-gradient(180deg,#111217,#0b0c10)] border border-red-900/40 rounded-md w-[640px] max-h-[85vh] overflow-auto shadow-[0_28px_120px_rgba(0,0,0,0.65)]" onClick={e => e.stopPropagation()}>
        <header className="px-6 pt-6 pb-4 flex items-start justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="h-8 w-8 rounded-full border border-red-500/40 bg-red-500/10 text-red-300 flex items-center justify-center">
                <IconFlame />
              </span>
              <h2 className="text-lg font-semibold tracking-tight">Delete project</h2>
            </div>
            <p className="text-sm text-fg-muted">
              Pick what to wipe for <span className="text-fg font-medium">{project.name}</span>. This cannot be undone.
            </p>
          </div>
          <button onClick={onClose} disabled={running} aria-label="Close" className="h-8 w-8 flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition disabled:opacity-40">
            <IconX />
          </button>
        </header>

        <div className="px-6 pb-6 space-y-4">
          {discovering ? (
            <div className="text-sm text-fg-dim py-8 text-center">Discovering resources…</div>
          ) : (
            <>
              <div className="space-y-2">
                {items.map(it => {
                  const k = key(it);
                  const checked = picked.has(k);
                  const isFolder = it.kind === 'folder';
                  return (
                    <label key={k}
                      className={`flex items-start gap-3 px-3 py-2.5 rounded-md border transition cursor-pointer
                        ${checked
                          ? 'border-red-500/40 bg-red-500/5'
                          : 'border-border-strong bg-bg/60 hover:border-zinc-600'}`}>
                      <input type="checkbox"
                        checked={checked}
                        disabled={running}
                        onChange={() => toggle(it)}
                        className="mt-0.5 accent-red-500" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-fg font-medium flex items-center gap-2">
                          {it.label}
                          {isFolder && <span className="text-[10px] uppercase tracking-wider text-red-300 bg-red-500/15 border border-red-500/30 rounded-full px-1.5 py-px">Caution</span>}
                        </div>
                        {it.sublabel && <div className="text-[11px] text-fg-dim mt-0.5 font-mono break-all">{it.sublabel}</div>}
                      </div>
                    </label>
                  );
                })}
                {items.length === 0 && (
                  <div className="text-[12px] text-fg-dim text-center py-4">No Cloudflare resources detected for this project's name.</div>
                )}
              </div>

              <label className="flex items-center gap-2 px-1 text-[12px] text-fg-muted cursor-pointer">
                <input type="checkbox"
                  checked={removeFromList}
                  disabled={running}
                  onChange={() => setRemoveFromList(v => !v)}
                  className="accent-zinc-400" />
                Also remove from project list when done
              </label>

              {logs.length > 0 && (
                <div className="bg-bg border border-border-strong rounded-md p-3 font-mono text-[11px] max-h-[200px] overflow-auto space-y-0.5">
                  {logs.map((l, i) => (
                    <div key={i} className={l.tone === 'ok' ? 'text-green-300' : l.tone === 'err' ? 'text-red-300' : 'text-fg-muted'}>
                      {l.text}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={done ? onDeleted : onClose} disabled={running}
                  className="h-9 px-4 text-xs border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition disabled:opacity-40">
                  {done ? 'Close' : 'Cancel'}
                </button>
                {!done && (
                  <button onClick={run} disabled={!canRun}
                    className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-md text-red-100 bg-red-500/80 border border-red-500 hover:bg-red-500 transition disabled:opacity-40">
                    <IconFlame />
                    {running ? 'Deleting…' : `Delete ${selectedCount + (removeFromList ? 1 : 0)} item${selectedCount + (removeFromList ? 1 : 0) === 1 ? '' : 's'}`}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function splitHostByZone(host: string, zones: { name: string }[]): { subdomain: string; zoneName: string } | null {
  const clean = host.toLowerCase();
  const zone = zones
    .filter(z => clean === z.name || clean.endsWith(`.${z.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (!zone || clean === zone.name) return null;
  return { subdomain: clean.slice(0, -zone.name.length - 1), zoneName: zone.name };
}

function ApiTesterModal({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg border border-border-strong rounded-lg w-[720px] max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Test API</h2>
            <p className="text-[11px] text-fg-dim mt-0.5 font-mono">{name}</p>
          </div>
          <button onClick={onClose} className="text-fg-muted hover:text-fg text-lg">×</button>
        </header>
        <div className="p-6 overflow-y-auto flex-1">
          <ApiTester defaultUrl={url} />
        </div>
      </div>
    </div>
  );
}

function OverflowMenu({
  onEditLiveUrl, onExternalEditor, onOpenFolder, onPurge, onRemove,
}: {
  onEditLiveUrl: () => void;
  onExternalEditor: () => void;
  onOpenFolder: () => void;
  onPurge: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Close on click outside the menu. Previous version fired on ANY mousedown,
  // which ran before MenuItem clicks resolved and made the menu unclickable.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const id = window.setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => { window.clearTimeout(id); window.removeEventListener('mousedown', onDown); };
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-9 w-9 flex items-center justify-center border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition"
        aria-label="More actions"
        title="More actions"
      >
        <IconMore />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-20 bg-bg border border-border-strong rounded-md shadow-xl min-w-[220px] py-1">
          <MenuItem icon={<IconGlobe />}  onClick={() => { setOpen(false); onEditLiveUrl(); }}>Edit live URL</MenuItem>
          <MenuItem icon={<IconCode />}   onClick={() => { setOpen(false); onExternalEditor(); }}>Open in external editor</MenuItem>
          <MenuItem icon={<IconFolder />} onClick={() => { setOpen(false); onOpenFolder(); }}>Open folder in file manager</MenuItem>
          <div className="border-t border-border my-1" />
          <MenuItem icon={<IconTrash />}  onClick={() => { setOpen(false); onRemove(); }} variant="danger">
            Remove from list
          </MenuItem>
          <MenuItem icon={<IconFlame />}  onClick={() => { setOpen(false); onPurge(); }} variant="danger">
            Delete project…
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, disabled, variant, icon }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean;
  variant?: 'warn' | 'danger';
  icon?: React.ReactNode;
}) {
  const tone = disabled
    ? 'text-fg-faint'
    : variant === 'warn' ? 'text-yellow-300 hover:bg-yellow-950/30'
    : variant === 'danger' ? 'text-red-300 hover:bg-red-950/30'
    : 'text-fg-muted hover:text-fg hover:bg-bg-elev';
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex items-center gap-2.5 w-full text-left px-3 py-2 text-[12px] ${tone} disabled:cursor-not-allowed`}>
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

function LivenessBadge({ state, status }: { state: Liveness; status: number | null }) {
  let dotCls: string;
  let textCls: string;
  let label: string;
  // Color the dot by status; the label is sentence case. Pulse the dot only
  // while we're actually probing — solid otherwise so it doesn't distract.
  let pulse = false;
  if (state === 'checking')        { dotCls = 'bg-zinc-500';                                                textCls = 'text-fg-muted'; label = 'Checking…';   pulse = true; }
  else if (state === 'stopped')    { dotCls = 'bg-zinc-600';                                                textCls = 'text-fg-dim';   label = 'Stopped'; }
  else if (state === 'unreachable'){ dotCls = 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)]';          textCls = 'text-red-300';  label = 'Unreachable'; }
  else if (state === 'live') {
    if (status == null || (status >= 200 && status < 300)) {
      dotCls = 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.55)]'; textCls = 'text-green-300'; label = `Live · ${status ?? 200}`;
    } else if (status >= 300 && status < 400) {
      dotCls = 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.5)]';    textCls = 'text-sky-300';   label = `Live · ${status}`;
    } else {
      dotCls = 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]';  textCls = 'text-amber-300'; label = `Live · ${status}`;
    }
  }
  else { dotCls = 'bg-zinc-600'; textCls = 'text-fg-dim'; label = '—'; }
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-bg/60 border border-border-strong ${textCls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotCls} ${pulse ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  );
}

function renderEvent(e: ProjectProgress) {
  switch (e.kind) {
    case 'step_start': return <span className="text-fg">▶ {e.label}</span>;
    case 'step_done':  return <span className="text-green-300">✓ {e.step.replace(/_/g, ' ')}</span>;
    case 'line':
      return <span className={e.line.stream === 'stderr' ? 'text-yellow-200/80 pl-3' : 'text-fg-muted pl-3'}>{e.line.text}</span>;
    case 'success':    return <span className="text-green-300">✓ Done. {e.url ? `→ ${e.url}` : ''}</span>;
    case 'error':      return <span className="text-red-300">✗ {e.step}: {e.message}</span>;
  }
}

async function streamProgress(
  eventId: string,
  set: (fn: (s: ProjectProgress[]) => ProjectProgress[]) => void,
  onTerminal: () => void,
): Promise<Stop> {
  let stop: Stop = () => {};
  stop = await streamProjectProgress(eventId, (evt: ProjectProgress) => {
    set(s => [...s, evt]);
    if (evt.kind === 'success' || evt.kind === 'error') {
      setTimeout(() => { try { Promise.resolve(stop()).catch(() => {}); } catch {} onTerminal(); }, 50);
    }
  });
  return stop;
}

// ── Wizard ───────────────────────────────────────────────────────────────

function NewProjectWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { zones } = useStore();
  const [step, setStep] = useState<'pick' | 'configure' | 'progress'>('pick');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tpl, setTpl] = useState<Template | null>(null);
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [zoneName, setZoneName] = useState<string>('');
  const [freeFormDomain, setFreeFormDomain] = useState('');
  const [progress, setProgress] = useState<ProjectProgress[]>([]);
  const [done, setDone] = useState(false);
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const composedDomain = zoneName === '__free__'
    ? freeFormDomain.trim()
    : (subdomain.trim() && zoneName ? `${subdomain.trim()}.${zoneName}` : '');

  useEffect(() => { api.listTemplates().then(setTemplates).catch(() => {}); }, []);

  async function pickFolder() {
    if (getConnection().mode === 'remote') {
      setPickerOpen(true);
      return;
    }
    try {
      const p = await api.pickProjectFolder();
      if (p) setFolder(p);
    } catch {}
  }

  async function create() {
    if (!tpl || !name.trim() || !folder.trim()) return;
    setStep('progress'); setProgress([]); setDone(false); setFinalUrl(null);
    const spec: CreateSpec = {
      templateId: tpl.id,
      name: name.trim(),
      folder: folder.trim(),
      customDomain: composedDomain || null,
    };
    try {
      const eventId = await api.startCreateProject(spec);
      await streamProgress(eventId, setProgress, () => {
        setDone(true);
        setProgress(s => {
          const success = s.find(e => e.kind === 'success');
          if (success && success.kind === 'success') setFinalUrl(success.url);
          return s;
        });
      });
    } catch (e: any) {
      setProgress(s => [...s, { kind: 'error', step: 'scaffold', message: e?.message ?? String(e) }]);
      setDone(true);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={step === 'progress' && !done ? undefined : onClose}>
      <div className="bg-bg border border-border-strong rounded-lg w-[720px] max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">New project</h2>
            <p className="text-[11px] text-fg-dim mt-0.5">
              {step === 'pick' && 'Pick a template'}
              {step === 'configure' && tpl && `Configure: ${tpl.label}`}
              {step === 'progress' && (done ? 'Result' : 'Creating…')}
            </p>
          </div>
          {(step !== 'progress' || done) && <button onClick={onClose} className="text-fg-muted hover:text-fg text-lg">×</button>}
        </header>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {step === 'pick' && (
            <div className="grid grid-cols-1 gap-2">
              {templates.length === 0 && <div className="text-fg-dim text-sm">Loading templates…</div>}
              {templates.map(t => (
                <button key={t.id} onClick={() => { setTpl(t); setStep('configure'); }}
                  className="text-left bg-bg-elev border border-border hover:border-fg rounded-md p-4">
                  <div className="font-semibold text-fg">{t.label}</div>
                  <div className="text-[11px] text-fg-dim mt-1">{t.description}</div>
                  <div className="text-[10px] text-fg-faint font-mono mt-2 uppercase tracking-wider">
                    {t.kind}{t.database !== 'none' && ` · ${t.database}`}
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 'configure' && tpl && (
            <div className="space-y-4">
              <Field label="Project name" hint="Lowercase letters, numbers, hyphens. This becomes the Worker name and the URL prefix.">
                <input value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  spellCheck={false} autoFocus placeholder="my-cool-api"
                  className="w-full bg-bg-elev border border-border rounded px-3 py-2 font-mono text-sm" />
              </Field>

              <Field label="Folder" hint="The project folder will be created inside this directory.">
                <div className="flex gap-2">
                  <input value={folder} onChange={e => setFolder(e.target.value)} spellCheck={false}
                    placeholder="C:\Users\…\Projects"
                    className="flex-1 bg-bg-elev border border-border rounded px-3 py-2 font-mono text-sm" />
                  <button onClick={pickFolder} className="px-3 py-2 border border-border rounded text-xs text-fg-muted hover:text-fg">
                    Browse…
                  </button>
                </div>
              </Field>

              <Field label="Custom domain (optional)"
                hint={zones.length > 0
                  ? "Pick one of your Cloudflare domains. Leave the zone empty to use the auto-generated *.workers.dev URL."
                  : "No zones loaded — make sure your API token has Zone:Read. Falls back to free-text input below."}>
                {zones.length > 0 && zoneName !== '__free__' ? (
                  <div className="flex gap-1 items-stretch">
                    <input
                      value={subdomain}
                      onChange={e => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                      spellCheck={false}
                      placeholder="api"
                      className="flex-1 bg-bg-elev border border-border rounded px-3 py-2 font-mono text-sm" />
                    <span className="text-fg-muted self-center px-1 font-mono text-sm">.</span>
                    <select
                      value={zoneName}
                      onChange={e => setZoneName(e.target.value)}
                      className="bg-bg-elev border border-border rounded px-3 py-2 font-mono text-sm min-w-[180px]">
                      <option value="">— none (workers.dev only) —</option>
                      {zones.map(z => <option key={z.id} value={z.name}>{z.name}</option>)}
                      <option value="__free__">(other / type manually)</option>
                    </select>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <input
                      value={freeFormDomain}
                      onChange={e => setFreeFormDomain(e.target.value)}
                      spellCheck={false}
                      placeholder="api.example.com"
                      className="w-full bg-bg-elev border border-border rounded px-3 py-2 font-mono text-sm" />
                    {zones.length > 0 && (
                      <button
                        type="button"
                        onClick={() => { setZoneName(''); setFreeFormDomain(''); }}
                        className="text-[11px] text-fg-muted hover:text-fg">
                        ← back to zone picker
                      </button>
                    )}
                  </div>
                )}
                {composedDomain && (
                  <div className="text-[11px] text-fg-dim font-mono pt-1">
                    → <span className="text-fg">https://{composedDomain}</span>
                  </div>
                )}
              </Field>

              {tpl.database === 'd1' && (
                <div className="text-[11px] text-fg-dim bg-bg-elev border border-border-subtle rounded p-3">
                  This template includes a D1 database. We'll create one named <code className="font-mono text-fg">{name || '<name>'}</code> and wire it up automatically.
                </div>
              )}

              <div className="flex justify-between pt-2">
                <button onClick={() => setStep('pick')} className="text-xs text-fg-muted hover:text-fg">← Back</button>
                <button onClick={create} disabled={!name || !folder}
                  className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-4 py-2 text-xs font-semibold disabled:opacity-40">
                  Create + deploy
                </button>
              </div>
            </div>
          )}

          {step === 'progress' && (
            <div className="space-y-3">
              <div className="bg-bg border border-border rounded p-3 font-mono text-[11px] max-h-[400px] overflow-auto">
                {progress.length === 0 && <div className="text-fg-dim">Starting…</div>}
                <ul className="space-y-0.5">
                  {progress.map((e, i) => <li key={i}>{renderEvent(e)}</li>)}
                </ul>
              </div>
              {done && (
                <div className="flex items-center justify-between">
                  <div>
                    {finalUrl && (
                      <div className="text-sm">
                        <span className="text-fg-dim">Live: </span>
                        <a href={finalUrl} target="_blank" rel="noreferrer" className="text-fg hover:underline font-mono break-all">{finalUrl}</a>
                      </div>
                    )}
                  </div>
                  <button onClick={onCreated}
                    className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-4 py-2 text-xs font-semibold">
                    Done
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {pickerOpen && (
        <RemoteFolderPicker
          title="Pick a folder on the remote server"
          initialPath={folder || null}
          onClose={() => setPickerOpen(false)}
          onPick={(p) => { setPickerOpen(false); setFolder(p); }}
        />
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] uppercase tracking-wider text-fg-muted font-semibold">{label}</span>
      {children}
      {hint && <div className="text-[11px] text-fg-dim leading-relaxed">{hint}</div>}
    </label>
  );
}

// ── Inline icons (kept local — Sidebar's icon set isn't exported yet) ────

function IconGlobe() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>
    </svg>
  );
}
function IconX() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  );
}
function IconChevronLeft() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  );
}
function IconTrash() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
  );
}
function IconMore() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>
    </svg>
  );
}
function IconCode() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
    </svg>
  );
}
function IconFolder() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
    </svg>
  );
}
function IconFlame() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22c5 0 8-3.5 8-8 0-3-2-5-3-6 0 2-1 3-2 3-1 0-1-1-1-3 0-3-2-5-5-7 .5 3-2 5-3.5 7C4 10 3 12 3 14c0 4.5 3 8 9 8z"/>
    </svg>
  );
}
