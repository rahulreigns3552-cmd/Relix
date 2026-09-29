import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChannelPlatform, ChannelRecord } from '../../lib/types';
import { api } from '../../lib/api';
import { useProject } from '../../lib/ProjectContext';
import { useToast } from '../Toast';

const PLATFORMS: { id: ChannelPlatform; name: string; placeholder: string }[] = [
  { id: 'instagram', name: 'Instagram', placeholder: 'https://www.instagram.com/yourhandle/' },
  { id: 'linkedin', name: 'LinkedIn', placeholder: 'https://www.linkedin.com/company/yourbrand/' },
  { id: 'twitter', name: 'X / Twitter', placeholder: 'https://x.com/yourhandle' },
  { id: 'youtube', name: 'YouTube', placeholder: 'https://www.youtube.com/@yourchannel' },
  { id: 'whatsapp', name: 'WhatsApp', placeholder: 'https://wa.me/919876543210' },
  { id: 'email', name: 'Email / Newsletter', placeholder: 'you@brand.com or https://brand.substack.com' },
];

const POLL_MS = 10_000;
const CREDENTIAL_PLATFORMS: ChannelPlatform[] = ['instagram', 'whatsapp', 'email'];

function blank(id: ChannelPlatform, name: string): ChannelRecord {
  return {
    platform: id,
    name,
    url: '',
    status: 'disconnected',
    message: '',
    connector: null,
    connectUrl: null,
    accountId: null,
    updatedAt: null,
  };
}

export function Channels() {
  const { projectId } = useProject();
  const { toast } = useToast();
  const [records, setRecords] = useState<Record<string, ChannelRecord>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const dirty = useRef<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const { items } = await api.getChannels(projectId);
      const map: Record<string, ChannelRecord> = {};
      for (const c of items) map[c.platform] = c;
      setRecords(map);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const c of items) if (!dirty.current[c.platform]) next[c.platform] = c.url || '';
        return next;
      });
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load channels.');
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    dirty.current = {};
    setRecords({});
    setDrafts({});
    setErrors({});
    setLoaded(false);
    load();
  }, [load]);

  const anyConnecting = Object.values(records).some((r) => r.status === 'connecting');
  useEffect(() => {
    if (!anyConnecting) return;
    const t = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(t);
  }, [anyConnecting, load]);

  function setBusyFor(id: string, v: boolean) {
    setBusy((b) => ({ ...b, [id]: v }));
  }

  async function connect(id: ChannelPlatform, name: string) {
    const url = (drafts[id] || '').trim();
    const usesSavedKey = CREDENTIAL_PLATFORMS.includes(id);
    if (!url && !usesSavedKey) {
      setErrors((e) => ({ ...e, [id]: `Paste your ${name} URL before turning this on.` }));
      return;
    }
    setErrors((e) => ({ ...e, [id]: '' }));
    setBusyFor(id, true);
    try {
      if (usesSavedKey) {
        const tested = await api.testConnections(
          projectId,
          id as 'instagram' | 'whatsapp' | 'email',
          url || undefined,
        );
        const row = tested.results[0];
        if (!row) throw new Error('Connection check returned no result.');
        dirty.current[id] = false;
        setRecords((r) => ({ ...r, [id]: row.channel }));
        if (row.channel.url) setDrafts((d) => ({ ...d, [id]: row.channel.url }));
        if (!row.ok) {
          setErrors((e) => ({ ...e, [id]: row.message }));
          return;
        }
        toast(`${name}: ${row.message}`, 'info');
        return;
      }
      const { channel } = await api.connectChannel(projectId, id, url);
      dirty.current[id] = false;
      setRecords((r) => ({ ...r, [id]: channel }));
      setDrafts((d) => ({ ...d, [id]: channel.url }));
      toast(`Connecting ${name}… we'll notify you when it's done.`, 'info');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed.';
      setErrors((e) => ({ ...e, [id]: msg }));
      await load();
    } finally {
      setBusyFor(id, false);
    }
  }

  async function disconnect(id: ChannelPlatform, name: string) {
    setBusyFor(id, true);
    try {
      const { channel } = await api.disconnectChannel(projectId, id);
      setRecords((r) => ({ ...r, [id]: channel }));
      setErrors((e) => ({ ...e, [id]: '' }));
      toast(`${name} disconnected.`, 'info');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not disconnect.', 'error');
    } finally {
      setBusyFor(id, false);
    }
  }

  return (
    <div className="card">
      <h3 className="card-title">Channels</h3>
      <p className="card-sub">
        Instagram, WhatsApp, and email use the keys saved in Settings. Turn the toggle on to
        check the saved key. Other channels still use the account URL.
      </p>
      {loadError && <div className="channel-error" style={{ marginBottom: 12 }}>{loadError}</div>}
      <div className="channel-list">
        {PLATFORMS.map(({ id, name, placeholder }) => {
          const rec = records[id] || blank(id, name);
          const on = rec.status === 'connecting' || rec.status === 'connected';
          const isBusy = !!busy[id] || !loaded;
          const err = errors[id];
          return (
            <div key={id} className={`channel-row channel-${rec.status}`}>
              <div>
                <div className="channel-name">{name}</div>
                <ChannelChip rec={rec} />
              </div>
              <div className="toggle-wrap">
                <button
                  type="button"
                  className={`toggle ${on ? 'on' : ''}`}
                  aria-label={`Toggle ${name}`}
                  aria-pressed={on}
                  disabled={isBusy}
                  onClick={() => (on ? disconnect(id, name) : connect(id, name))}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {busy[id] ? '…' : on ? 'On' : 'Off'}
                </span>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <input
                  value={drafts[id] ?? ''}
                  className={err ? 'invalid' : ''}
                  aria-invalid={!!err}
                  disabled={on}
                  onChange={(e) => {
                    dirty.current[id] = true;
                    setDrafts((d) => ({ ...d, [id]: e.target.value }));
                    if (err) setErrors((x) => ({ ...x, [id]: '' }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !on) connect(id, name);
                  }}
                  placeholder={placeholder}
                />
                {err && <span className="channel-error">{err}</span>}
                {!err && rec.status === 'failed' && rec.message && (
                  <span className="channel-error">
                    {rec.message}
                    {rec.connectUrl && (
                      <>
                        {' '}
                        <a href={rec.connectUrl} target="_blank" rel="noopener noreferrer" className="channel-link">
                          Finish connecting ↗
                        </a>
                      </>
                    )}
                  </span>
                )}
                {!err && rec.status === 'connected' && (rec.message || rec.accountId) && (
                  <span className="field-hint">
                    {rec.message}
                    {rec.accountId ? `${rec.message ? ' · ' : ''}Account ${rec.accountId}` : ''}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChannelChip({ rec }: { rec: ChannelRecord }) {
  if (rec.status === 'connecting') {
    return (
      <span className="badge channel-chip chip-connecting">
        <span className="chip-dot" /> Connecting...
      </span>
    );
  }
  if (rec.status === 'connected') {
    return (
      <span className="badge channel-chip chip-connected" title={rec.message || undefined}>
        Connected{rec.connector ? ` · ${rec.connector}` : ''}
      </span>
    );
  }
  if (rec.status === 'failed') {
    return (
      <span className="badge channel-chip chip-failed" title={rec.message || undefined}>
        Failed
      </span>
    );
  }
  return <span className="badge badge-muted channel-chip">Not connected</span>;
}
