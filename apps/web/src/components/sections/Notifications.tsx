import { useEffect, useState } from 'react';
import type { RelixNotification } from '../../lib/types';

const TTL_MS = 48 * 60 * 60 * 1000;

export function kindIcon(kind: RelixNotification['kind']) {
  if (kind === 'success') return '✓';
  if (kind === 'warning') return '!';
  if (kind === 'error') return '✕';
  return 'i';
}

function timeAgo(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return 'Yesterday';
}

function clockTime(iso: string) {
  return `${new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST`;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

interface Props {
  items: RelixNotification[];
  readAt: string;
  onOpenSection: (section: string) => void;
  onMarkRead: () => void;
}

export function Notifications({ items, readAt, onOpenSection, onMarkRead }: Props) {
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState<'all' | RelixNotification['kind']>('all');
  const [initialReadAt] = useState(readAt);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    const r = window.setTimeout(onMarkRead, 800);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(r);
    };
  }, [onMarkRead]);

  const visible = items.filter(
    (n) => new Date(n.createdAt).getTime() + TTL_MS > now && (filter === 'all' || n.kind === filter)
  );
  const groups: { label: string; list: RelixNotification[] }[] = [];
  for (const n of visible) {
    const label = dayLabel(n.createdAt);
    const g = groups.find((x) => x.label === label);
    if (g) g.list.push(n);
    else groups.push({ label, list: [n] });
  }

  const filters: { id: typeof filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'warning', label: 'Needs you' },
    { id: 'success', label: 'Done' },
    { id: 'error', label: 'Problems' },
    { id: 'info', label: 'Updates' },
  ];

  return (
    <div className="notif-page">
      <div className="notif-head">
        <div>
          <h3>Every change in this project</h3>
        </div>
        <div className="notif-filters">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`notif-filter ${filter === f.id ? 'active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 && (
        <div className="empty-state notif-empty">
          <strong>No notifications</strong>
          <p>New updates will show up here.</p>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.label} className="notif-group">
          <div className="notif-group-label">{g.label}</div>
          <div className="notif-list">
            {g.list.map((n, i) => {
              const isNew = !initialReadAt || n.createdAt > initialReadAt;
              return (
                <button
                  type="button"
                  key={n.id}
                  className={`notif-row notif-${n.kind} ${isNew ? 'is-new' : ''} ${n.section ? 'clickable' : ''}`}
                  style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
                  onClick={() => n.section && n.section !== 'notifications' && onOpenSection(n.section)}
                >
                  <span className="notif-icon">{kindIcon(n.kind)}</span>
                  <div className="notif-row-text">
                    <strong>{n.title}</strong>
                    {n.body && <span>{n.body}</span>}
                  </div>
                  <div className="notif-row-side">
                    <div className="notif-when">
                      <span className="notif-ago">{timeAgo(n.createdAt, now)}</span>
                      <span className="notif-clock">{clockTime(n.createdAt)}</span>
                    </div>
                    {n.section && n.section !== 'notifications' && (
                      <span className="notif-go" aria-hidden>
                        ›
                      </span>
                    )}
                  </div>
                  {isNew && <span className="notif-new-dot" aria-label="New" />}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
