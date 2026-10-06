import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../lib/api';
import { useProject } from '../../lib/ProjectContext';
import type { AnalyticsPayload, AnalyticsPost } from '../../lib/types';
import { useToast } from '../Toast';

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Calcutta',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function fmtPostedDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Calcutta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function AnalyticsThumb({ src, className }: { src?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);
  if (!src || broken) {
    return <div className="analytics-card-placeholder">IG</div>;
  }
  return (
    <img
      className={className}
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}

type MetricBar = { label: string; value: number; suffix?: string };

function MetricBars({
  title,
  items,
  accent = '#f97316',
}: {
  title: string;
  items: MetricBar[];
  accent?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="analytics-chart-card">
      <div className="analytics-chart-title">{title}</div>
      <div className="analytics-bar-chart" role="img" aria-label={title}>
        {items.map((item) => {
          const pct = Math.max(4, Math.round((item.value / max) * 100));
          return (
            <div key={item.label} className="analytics-bar-row">
              <div className="analytics-bar-label">{item.label}</div>
              <div className="analytics-bar-track">
                <div
                  className="analytics-bar-fill"
                  style={{ width: `${pct}%`, background: accent }}
                />
              </div>
              <div className="analytics-bar-value">
                {item.value}
                {item.suffix || ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricColumnChart({
  title,
  items,
}: {
  title: string;
  items: MetricBar[];
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const w = 320;
  const h = 160;
  const padL = 8;
  const padR = 8;
  const padT = 16;
  const padB = 28;
  const gap = 10;
  const innerW = w - padL - padR;
  const barW = (innerW - gap * (items.length - 1)) / Math.max(items.length, 1);
  const chartH = h - padT - padB;

  return (
    <div className="analytics-chart-card">
      <div className="analytics-chart-title">{title}</div>
      <svg
        className="analytics-column-chart"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={title}
      >
        {[0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + chartH * (1 - t);
          return (
            <line
              key={t}
              x1={padL}
              x2={w - padR}
              y1={y}
              y2={y}
              className="analytics-chart-grid"
            />
          );
        })}
        {items.map((item, i) => {
          const barH = Math.max(2, (item.value / max) * chartH);
          const x = padL + i * (barW + gap);
          const y = padT + chartH - barH;
          return (
            <g key={item.label}>
              <rect
                className="analytics-column-bar"
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={6}
                style={{ animationDelay: `${i * 60}ms` }}
              />
              <text
                x={x + barW / 2}
                y={y - 6}
                textAnchor="middle"
                className="analytics-column-value"
              >
                {item.value}
                {item.suffix || ''}
              </text>
              <text
                x={x + barW / 2}
                y={h - 8}
                textAnchor="middle"
                className="analytics-column-label"
              >
                {item.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function EngagementDonut({
  likes,
  comments,
  shares,
  saves,
}: {
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}) {
  const parts = [
    { label: 'Likes', value: likes, color: '#f97316' },
    { label: 'Comments', value: comments, color: '#fb923c' },
    { label: 'Shares', value: shares, color: '#fdba74' },
    { label: 'Saves', value: saves, color: '#ea580c' },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;

  if (total <= 0) {
    return (
      <div className="analytics-chart-card">
        <div className="analytics-chart-title">Engagement mix</div>
        <div className="analytics-donut-empty">No engagement yet</div>
      </div>
    );
  }

  return (
    <div className="analytics-chart-card">
      <div className="analytics-chart-title">Engagement mix</div>
      <div className="analytics-donut-wrap">
        <svg viewBox="0 0 120 120" className="analytics-donut" role="img" aria-label="Engagement mix">
          <g transform="translate(60,60) rotate(-90)">
            {parts.map((p) => {
              const len = (p.value / total) * c;
              const dash = `${len} ${c - len}`;
              const el = (
                <circle
                  key={p.label}
                  r={r}
                  fill="none"
                  stroke={p.color}
                  strokeWidth={14}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  className="analytics-donut-seg"
                />
              );
              offset += len;
              return el;
            })}
          </g>
          <text x="60" y="56" textAnchor="middle" className="analytics-donut-total">
            {total}
          </text>
          <text x="60" y="72" textAnchor="middle" className="analytics-donut-sub">
            total
          </text>
        </svg>
        <ul className="analytics-donut-legend">
          {parts.map((p) => (
            <li key={p.label}>
              <span style={{ background: p.color }} />
              {p.label}
              <strong>{p.value}</strong>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Analytics() {
  const { projectId, project } = useProject();
  const { toast } = useToast();
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AnalyticsPost | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getAnalytics(projectId);
      setData(res);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load analytics', 'error');
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setSelected(null);
    load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [selected]);

  const selectedMetrics = useMemo(() => {
    const m = selected?.metrics;
    if (!m) return null;
    return {
      reachItems: [
        { label: 'Impressions', value: m.impressions ?? 0 },
        { label: 'Reach', value: m.reach ?? 0 },
        { label: 'Views', value: m.views ?? 0 },
        { label: 'Clicks', value: m.clicks ?? 0 },
      ],
      engageBars: [
        { label: 'Likes', value: m.likes ?? 0 },
        { label: 'Comments', value: m.comments ?? 0 },
        { label: 'Shares', value: m.shares ?? 0 },
        { label: 'Saves', value: m.saves ?? 0 },
      ],
      rate: m.engagementRate ?? 0,
      likes: m.likes ?? 0,
      comments: m.comments ?? 0,
      shares: m.shares ?? 0,
      saves: m.saves ?? 0,
    };
  }, [selected]);

  if (loading) {
    return (
      <div className="empty-state">
        <strong>Loading Instagram analytics…</strong>
      </div>
    );
  }

  const posts = data?.posts || [];

  const detail =
    selected && selectedMetrics
      ? createPortal(
          <div
            className="analytics-detail-backdrop"
            role="presentation"
            onClick={() => setSelected(null)}
          >
            <div
              className="analytics-detail card"
              role="dialog"
              aria-modal="true"
              aria-label="Post analytics detail"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="analytics-detail-header">
                <h3 className="card-title">Post detail</h3>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelected(null)}
                >
                  Close
                </button>
              </div>
              <div className="analytics-detail-layout">
                <div className="analytics-detail-media">
                  <AnalyticsThumb src={selected.thumbnailUrl} />
                </div>
                <div className="analytics-detail-body">
                  <div className="list-item-meta">
                    Posted {fmtDate(selected.publishedAt)} IST
                    {selected.calendarPostId ? ` · ${selected.calendarPostId}` : ''}
                  </div>
                  <div className="analytics-detail-caption">{selected.caption}</div>
                  {selected.platformPostUrl && (
                    <p>
                      <a
                        href={selected.platformPostUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="analytics-ig-link"
                      >
                        Open on Instagram ↗
                      </a>
                    </p>
                  )}
                  <div className="analytics-rate-pill">
                    Engagement rate <strong>{selectedMetrics.rate}%</strong>
                  </div>
                </div>
              </div>
              <div className="analytics-charts-grid">
                <MetricColumnChart title="Reach & visibility" items={selectedMetrics.reachItems} />
                <EngagementDonut
                  likes={selectedMetrics.likes}
                  comments={selectedMetrics.comments}
                  shares={selectedMetrics.shares}
                  saves={selectedMetrics.saves}
                />
                <MetricBars title="Engagement breakdown" items={selectedMetrics.engageBars} />
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="section-stack">
      <div className="card">
        <h3 className="card-title">Instagram analytics — {project.name}</h3>
        <p className="card-sub">
          Published posts for {data?.account || 'this project'}. Click a post for live graphs.
          {data?.updatedAt ? ` Updated ${fmtDate(data.updatedAt)} IST.` : ''}
        </p>

        {posts.length === 0 ? (
          <div className="empty-state">
            <strong>No published posts yet</strong>
            Analytics will appear here after Relix syncs Instagram metrics.
          </div>
        ) : (
          <div className="analytics-grid">
            {posts.map((post) => (
              <button
                key={post.id}
                type="button"
                className="analytics-card"
                onClick={() => setSelected(post)}
              >
                <div className="analytics-card-media">
                  <AnalyticsThumb src={post.thumbnailUrl} />
                </div>
                <div className="analytics-card-body">
                  <div className="analytics-caption">{post.caption || 'No caption'}</div>
                  <div className="analytics-posted-date">{fmtPostedDate(post.publishedAt)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {detail}
    </div>
  );
}
