import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ChannelPlatform, ChannelRecord } from '../../lib/types';
import { api } from '../../lib/api';
import { useProject } from '../../lib/ProjectContext';
import { useToast } from '../Toast';

const OAUTH: { id: ChannelPlatform; name: string; logo: string }[] = [
  { id: 'instagram', name: 'Instagram', logo: '/media/connectors/instagram.svg' },
  { id: 'facebook', name: 'Facebook', logo: '/media/connectors/facebook.svg' },
  { id: 'linkedin', name: 'LinkedIn', logo: '/media/connectors/linkedin.svg' },
  { id: 'twitter', name: 'X', logo: '/media/connectors/x.svg' },
  { id: 'youtube', name: 'YouTube', logo: '/media/connectors/youtube.svg' },
  { id: 'tiktok', name: 'TikTok', logo: '/media/connectors/tiktok.svg' },
  { id: 'threads', name: 'Threads', logo: '/media/connectors/threads.svg' },
  { id: 'pinterest', name: 'Pinterest', logo: '/media/connectors/pinterest.svg' },
];

const MANUAL: { id: 'whatsapp' | 'email'; name: string; placeholder: string }[] = [
  { id: 'whatsapp', name: 'WhatsApp', placeholder: 'https://wa.me/919876543210' },
  { id: 'email', name: 'Email / Newsletter', placeholder: 'you@brand.com' },
];

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
    username: null,
    updatedAt: null,
  };
}

export function Channels({ isAdmin = false }: { isAdmin?: boolean }) {
  const { projectId } = useProject();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [records, setRecords] = useState<Record<string, ChannelRecord>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api.getChannels(projectId);
      const map: Record<string, ChannelRecord> = {};
      for (const channel of result.items) map[channel.platform] = channel;
      setRecords(map);
      setConfigured(result.providerConfigured !== false);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load channels.');
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    setRecords({});
    setLoaded(false);
    void load();
  }, [load]);

  useEffect(() => {
    const connected = params.get('connected');
    const failed = params.get('error');
    if (!connected && !failed) return;
    const name = [...OAUTH, ...MANUAL].find((row) => row.id === (connected || failed))?.name || 'Channel';
    toast(connected ? `${name} connected.` : `${name} could not connect.`, connected ? 'success' : 'error');
    const next = new URLSearchParams(params);
    next.delete('connected');
    next.delete('error');
    setParams(next, { replace: true });
  }, [params, setParams, toast]);

  const anyConnecting = Object.values(records).some((row) => row.status === 'connecting');
  useEffect(() => {
    if (!anyConnecting) return;
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [anyConnecting, load]);

  async function connectOauth(id: ChannelPlatform) {
    setBusy((current) => ({ ...current, [id]: true }));
    setErrors((current) => ({ ...current, [id]: '' }));
    try {
      const result = await api.connectChannel(projectId, id);
      if (result.authUrl) {
        window.location.assign(result.authUrl);
        return;
      }
      setRecords((current) => ({ ...current, [id]: result.channel }));
    } catch (err) {
      setErrors((current) => ({ ...current, [id]: err instanceof Error ? err.message : 'Connection failed.' }));
    } finally {
      setBusy((current) => ({ ...current, [id]: false }));
    }
  }

  async function connectManual(id: 'whatsapp' | 'email', name: string) {
    const url = (drafts[id] || '').trim();
    if (!url && id !== 'whatsapp' && id !== 'email') return;
    setBusy((current) => ({ ...current, [id]: true }));
    try {
      const tested = await api.testConnections(projectId, id, url || undefined);
      const row = tested.results[0];
      if (!row) throw new Error('Connection check returned no result.');
      setRecords((current) => ({ ...current, [id]: row.channel }));
      if (!row.ok) setErrors((current) => ({ ...current, [id]: row.message }));
      else toast(`${name}: ${row.message}`, 'info');
    } catch (err) {
      setErrors((current) => ({ ...current, [id]: err instanceof Error ? err.message : 'Connection failed.' }));
    } finally {
      setBusy((current) => ({ ...current, [id]: false }));
    }
  }

  async function disconnect(id: ChannelPlatform, name: string) {
    setBusy((current) => ({ ...current, [id]: true }));
    try {
      const { channel } = await api.disconnectChannel(projectId, id);
      setRecords((current) => ({ ...current, [id]: channel }));
      toast(`${name} disconnected.`, 'info');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not disconnect.', 'error');
    } finally {
      setBusy((current) => ({ ...current, [id]: false }));
    }
  }

  return (
    <div className="card">
      <h3 className="card-title">Channels</h3>
      <p className="card-sub">Connect a network once. Relix posts only after you approve the preview.</p>
      {!configured && isAdmin && (
        <div className="channel-error" style={{ marginBottom: 12 }}>Posting service not configured</div>
      )}
      {!configured && !isAdmin && (
        <p className="card-sub">Connect isn’t available on this workspace yet.</p>
      )}
      {loadError && <div className="channel-error" style={{ marginBottom: 12 }}>{loadError}</div>}
      <div className="channel-list">
        {OAUTH.map(({ id, name, logo }) => {
          const rec = records[id] || blank(id, name);
          const connected = rec.status === 'connected';
          return (
            <div id={`channel-row-${id}`} key={id} className={`channel-row channel-${rec.status}`}>
              <div className="channel-id">
                <img className="channel-logo" src={logo} alt="" />
                <div>
                  <div className="channel-name">{name}</div>
                  <ChannelChip rec={rec} />
                </div>
              </div>
              <div className="channel-actions">
                {connected ? (
                  <button type="button" className="btn btn-ghost" disabled={!loaded || !!busy[id]} onClick={() => void disconnect(id, name)}>
                    Disconnect
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" disabled={!loaded || !!busy[id] || !configured} onClick={() => void connectOauth(id)}>
                    {busy[id] ? 'Connecting…' : 'Connect'}
                  </button>
                )}
              </div>
              <div>
                {errors[id] && <span className="channel-error">{errors[id]}</span>}
                {!errors[id] && rec.status === 'failed' && rec.message && <span className="channel-error">{rec.message}</span>}
                {connected && rec.username && <span className="field-hint">Connected · @{rec.username.replace(/^@/, '')}</span>}
              </div>
            </div>
          );
        })}
        {MANUAL.map(({ id, name, placeholder }) => {
          const rec = records[id] || blank(id, name);
          const on = rec.status === 'connected' || rec.status === 'connecting';
          return (
            <div id={`channel-row-${id}`} key={id} className={`channel-row channel-${rec.status}`}>
              <div>
                <div className="channel-name">{name}</div>
                <ChannelChip rec={rec} />
              </div>
              <button
                type="button"
                className={`toggle ${on ? 'on' : ''}`}
                aria-label={`Toggle ${name}`}
                aria-pressed={on}
                disabled={!loaded || !!busy[id]}
                onClick={() => (on ? void disconnect(id, name) : void connectManual(id, name))}
              />
              <div className="field" style={{ margin: 0 }}>
                <input
                  value={drafts[id] ?? rec.url ?? ''}
                  placeholder={placeholder}
                  disabled={on}
                  onChange={(event) => setDrafts((current) => ({ ...current, [id]: event.target.value }))}
                />
                {errors[id] && <span className="channel-error">{errors[id]}</span>}
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
    return <span className="badge channel-chip chip-connecting"><span className="chip-dot" /> Connecting...</span>;
  }
  if (rec.status === 'connected') {
    const handle = rec.username ? `@${rec.username.replace(/^@/, '')}` : '';
    return <span className="badge channel-chip chip-connected">Connected{handle ? ` · ${handle}` : ''}</span>;
  }
  if (rec.status === 'failed') return <span className="badge channel-chip chip-failed">Failed</span>;
  return <span className="badge badge-muted channel-chip">Not connected</span>;
}
