import type { AppData, NavSection } from '../../lib/types';

interface Props {
  data: AppData;
  onNavigate: (section: NavSection) => void;
}

export function Overview({ data, onNavigate }: Props) {
  const brandReady = Boolean(data.brand.brandName.trim());
  const connected = data.channels.filter((c) => c.connected).length;
  const lastUpdated = data.lastUpdated
    ? new Date(data.lastUpdated).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Never';

  return (
    <div className="section-stack">
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Brand status</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {brandReady ? 'Configured' : 'Incomplete'}
          </div>
          <div className="stat-meta">
            {brandReady ? data.brand.brandName : 'Add brand details'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Channels connected</div>
          <div className="stat-value">
            {connected}
            <span style={{ fontSize: 14, color: 'var(--text-dim)', fontWeight: 500 }}>
              {' '}
              / {data.channels.length}
            </span>
          </div>
          <div className="stat-meta">Publishing endpoints</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Briefs on file</div>
          <div className="stat-value">{data.briefs.length}</div>
          <div className="stat-meta">Content briefs</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Last updated</div>
          <div className="stat-value" style={{ fontSize: 16, paddingTop: 8 }}>
            {lastUpdated}
          </div>
          <div className="stat-meta">Local workspace sync</div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Quick actions</h3>
        <p className="card-sub">Jump into the most common control-panel tasks.</p>
        <div className="quick-actions">
          <button type="button" className="btn btn-primary" onClick={() => onNavigate('chat')}>
            Open chat
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => onNavigate('preview')}>
            Instagram preview
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => onNavigate('settings')}>
            Edit brand
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onNavigate('brief')}>
            Submit brief
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onNavigate('channels')}>
            Manage channels
          </button>
        </div>
      </div>
    </div>
  );
}
