import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useProject } from '../../lib/ProjectContext';
import type { IgPost } from '../../lib/types';
import { useToast } from '../Toast';

function istYmd(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Calcutta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function addDaysYmd(ymd: string, days: number) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function Preview() {
  const { projectId, project } = useProject();
  const { toast } = useToast();
  const [items, setItems] = useState<IgPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const today = istYmd();
  const tomorrow = addDaysYmd(today, 1);

  const load = useCallback(async () => {
    try {
      const data = await api.getIgQueue(projectId);
      setItems(data.items || []);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load IG queue', 'error');
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => {
    setLoading(true);
    setItems([]);
    setFeedbackFor(null);
    setFeedback('');
    load();
    const id = window.setInterval(load, 4000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (loading) return;
    let focusId = '';
    try {
      focusId = sessionStorage.getItem('relix_previewFocusId') || '';
      if (focusId) sessionStorage.removeItem('relix_previewFocusId');
    } catch {
      /* ignore */
    }
    if (!focusId) return;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(`ig-post-${focusId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ig-card-focus');
      window.setTimeout(() => el.classList.remove('ig-card-focus'), 2200);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [loading, items]);

  const actionable = useMemo(() => {
    const list = items.filter(
      (i) => i.status === 'pending' || i.status === 'changes_requested'
    );
    const rank = (i: IgPost) => {
      if (i.postDate === tomorrow) return 0;
      if (i.postDate === today) return 1;
      if (i.postDate && i.postDate > tomorrow) return 2;
      return 3;
    };
    return [...list].sort((a, b) => rank(a) - rank(b));
  }, [items, today, tomorrow]);

  const history = items.filter(
    (i) => i.status !== 'pending' && i.status !== 'changes_requested'
  );

  async function approve(id: string) {
    setBusyId(id);
    try {
      await api.approveIg(projectId, id);
      toast('Approved — publish is queued for the scheduled post date.');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Approve failed', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function retry(id: string) {
    setBusyId(id);
    try {
      await api.retryIg(projectId, id);
      toast('Publish queued again. Nothing goes live until this approved draft is posted.');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Retry failed', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    if (!window.confirm('Reject this post? It will not be published.')) return;
    setBusyId(id);
    try {
      await api.rejectIg(projectId, id);
      toast('Post rejected — it will not be published.', 'info');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Reject failed', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function submitChanges(id: string) {
    const text = feedback.trim();
    if (!text) {
      toast('Please describe the changes you need.', 'error');
      return;
    }
    setBusyId(id);
    try {
      await api.requestIgChanges(projectId, id, text);
      toast('Changes requested — Relix will revise.', 'info');
      setFeedbackFor(null);
      setFeedback('');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Request failed', 'error');
    } finally {
      setBusyId(null);
    }
  }

  function scheduleLabel(item: IgPost) {
    if (item.postDate === tomorrow) return "Tomorrow's post";
    if (item.postDate === today) return "Today's post";
    if (item.postDate) return `Scheduled ${item.postDate}`;
    return 'Scheduled post';
  }

  function renderCard(item: IgPost, showActions: boolean) {
    const tags = (item.hashtags || []).join(' ');
    const isTomorrow = item.postDate === tomorrow;
    return (
      <div id={`ig-post-${item.id}`} key={item.id} className={`ig-card${isTomorrow ? ' ig-card-tomorrow' : ''}`}>
        <div className="ig-card-media">
          <img src={item.imageUrl} alt="Instagram preview" />
        </div>
        <div className="ig-card-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="badge badge-primary">Instagram</span>
              {isTomorrow && <span className="badge badge-success">Tomorrow</span>}
            </div>
            <span
              className={`badge ${
                item.status === 'approved' || item.status === 'published'
                  ? 'badge-success'
                  : item.status === 'changes_requested'
                    ? 'badge-warning'
                    : item.status === 'rejected' || item.status === 'expired' || item.status === 'failed'
                      ? 'badge-danger'
                      : 'badge-muted'
              }`}
            >
              {item.status === 'changes_requested'
                ? 'Changes requested'
                : item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            </span>
          </div>
          <div className="list-item-meta" style={{ marginTop: 6 }}>
            <strong>{scheduleLabel(item)}</strong>
            {item.calendarPostId ? ` · ${item.calendarPostId}` : ''}
          </div>
          <div className="ig-caption">{item.caption}</div>
          {tags && <div className="ig-hashtags">{tags}</div>}
          {!item.feedback && (item as IgPost & { lastFeedback?: string }).lastFeedback && item.status === 'pending' && (
            <div className="ig-feedback-box">
              <strong>Revised per your feedback: </strong>
              {(item as IgPost & { lastFeedback?: string }).lastFeedback}
            </div>
          )}
          {item.feedback && (
            <div className="ig-feedback-box">
              <strong>Feedback: </strong>
              {item.feedback}
            </div>
          )}
          <div className="list-item-meta">
            <span>
              Updated{' '}
              {new Date(item.updatedAt).toLocaleString('en-IN', {
                timeZone: 'Asia/Calcutta',
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
              {item.postDate ? ` · Post date ${item.postDate}` : ''}
              {item.expiresAt
                ? ` · Expires ${new Date(item.expiresAt).toLocaleString('en-IN', {
                    timeZone: 'Asia/Calcutta',
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })} IST`
                : ''}
            </span>
          </div>

          {showActions && !(item.status === 'pending' || item.status === 'changes_requested') && (
            <>
              <div className="ig-actions">
                <button type="button" className="btn btn-success btn-sm" disabled>
                  Approve &amp; schedule
                </button>
                <button type="button" className="btn btn-warning btn-sm" disabled>
                  Request changes
                </button>
                <button type="button" className="btn btn-danger btn-sm" disabled>
                  Reject
                </button>
              </div>
              <div className="ig-locked-note">
                {item.status === 'published'
                  ? 'Already published — review actions are no longer available.'
                  : item.status === 'approved'
                    ? 'Approved — scheduled to publish on the post date.'
                    : item.status === 'rejected'
                      ? 'Rejected — this post will not be published.'
                      : item.status === 'failed'
                        ? 'Publishing failed. Retry queues the same approved post again.'
                        : 'Expired — this draft was not approved in time.'}
              {item.status === 'failed' && (
                <div className="ig-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busyId === item.id}
                    onClick={() => void retry(item.id)}
                  >
                    {busyId === item.id ? 'Retrying…' : 'Retry publish'}
                  </button>
                </div>
              )}
              </div>
            </>
          )}

          {showActions && (item.status === 'pending' || item.status === 'changes_requested') && (
            <>
              {feedbackFor === item.id ? (
                <div className="ig-change-form">
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="What should change? Caption, hashtags, creative direction…"
                    autoFocus
                  />
                  <div className="ig-actions">
                    <button
                      type="button"
                      className="btn btn-warning btn-sm"
                      disabled={busyId === item.id}
                      onClick={() => void submitChanges(item.id)}
                    >
                      {busyId === item.id ? 'Sending…' : 'Submit feedback'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setFeedbackFor(null);
                        setFeedback('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="ig-actions">
                  <button
                    type="button"
                    className="btn btn-success btn-sm"
                    disabled={busyId === item.id}
                    onClick={() => void approve(item.id)}
                  >
                    {busyId === item.id ? 'Working…' : 'Approve & schedule'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-warning btn-sm"
                    disabled={busyId === item.id}
                    onClick={() => {
                      setFeedbackFor(item.id);
                      setFeedback('');
                    }}
                  >
                    Request changes
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={busyId === item.id}
                    onClick={() => void reject(item.id)}
                  >
                    Reject
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="empty-state">
        <strong>Loading Instagram queue…</strong>
      </div>
    );
  }

  return (
    <div className="section-stack">
      <div className="card">
        <h3 className="card-title">Tomorrow&apos;s Instagram preview — {project.name}</h3>
        <p className="card-sub">
          Relix adds tomorrow&apos;s exact post here today so you can approve it or ask for changes
          before it goes out. Unapproved drafts expire the morning after the post date.
        </p>
        {actionable.length === 0 ? (
          <div className="empty-state">
            <strong>No draft for tomorrow yet</strong>
            Relix will place tomorrow&apos;s Instagram post here today for your review.
          </div>
        ) : (
          <div className="ig-grid">{actionable.map((item) => renderCard(item, true))}</div>
        )}
      </div>

      {history.length > 0 && (
        <div className="card">
          <h3 className="card-title">History</h3>
          <p className="card-sub">Approved, published, and expired items</p>
          <div className="ig-grid">{history.map((item) => renderCard(item, true))}</div>
        </div>
      )}
    </div>
  );
}
