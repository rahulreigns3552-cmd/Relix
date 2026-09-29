import { useState, type FormEvent } from 'react';
import type { AppData, BriefItem } from '../../lib/types';
import { uid } from '../../lib/storage';
import { useToast } from '../Toast';

interface Props {
  data: AppData;
  onSave: (briefs: BriefItem[]) => void;
}

const emptyForm = {
  title: '',
  platform: 'Instagram',
  tone: 'Professional',
  cta: '',
  keyMessage: '',
  deadline: '',
  notes: '',
};

export function Brief({ data, onSave }: Props) {
  const { toast } = useToast();
  const [form, setForm] = useState({ ...emptyForm });
  const [errors, setErrors] = useState<{ title?: boolean; keyMessage?: boolean }>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const nextErrors: typeof errors = {};
    if (!form.title.trim()) nextErrors.title = true;
    if (!form.keyMessage.trim()) nextErrors.keyMessage = true;
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      toast('Title and key message are required.', 'error');
      return;
    }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 300));
    const item: BriefItem = {
      id: uid('brief'),
      ...form,
      createdAt: new Date().toISOString(),
    };
    const next = [item, ...data.briefs];
    onSave(next);
    setForm({ ...emptyForm });
    setErrors({});
    setLoading(false);
    toast('Brief submitted.');
  }

  function handleDelete(id: string) {
    if (!window.confirm('Delete this brief?')) return;
    onSave(data.briefs.filter((b) => b.id !== id));
    toast('Brief deleted.', 'info');
  }

  return (
    <div className="section-stack">
      <div className="card">
        <h3 className="card-title">Post / campaign brief</h3>
        <p className="card-sub">Submit a brief for the agent team to execute.</p>
        <form onSubmit={handleSubmit}>
          <div className="form-grid two">
            <div className="field">
              <label htmlFor="briefTitle">Title *</label>
              <input
                id="briefTitle"
                value={form.title}
                onChange={(e) => {
                  setForm({ ...form, title: e.target.value });
                  setErrors((er) => ({ ...er, title: false }));
                }}
                className={errors.title ? 'error' : ''}
                placeholder="Launch teaser carousel"
              />
            </div>
            <div className="field">
              <label htmlFor="briefPlatform">Platform</label>
              <select
                id="briefPlatform"
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value })}
              >
                {['Instagram', 'LinkedIn', 'X/Twitter', 'YouTube', 'Email', 'Other'].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="briefTone">Tone</label>
              <select
                id="briefTone"
                value={form.tone}
                onChange={(e) => setForm({ ...form, tone: e.target.value })}
              >
                {['Professional', 'Casual', 'Bold', 'Playful', 'Empathetic', 'Authoritative'].map(
                  (t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  )
                )}
              </select>
            </div>
            <div className="field">
              <label htmlFor="briefCta">CTA</label>
              <input
                id="briefCta"
                value={form.cta}
                onChange={(e) => setForm({ ...form, cta: e.target.value })}
                placeholder="Book a demo / Learn more"
              />
            </div>
            <div className="field">
              <label htmlFor="briefDeadline">Deadline</label>
              <input
                id="briefDeadline"
                type="date"
                value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
              />
            </div>
          </div>
          <div className="form-grid" style={{ marginTop: 16 }}>
            <div className="field">
              <label htmlFor="briefKey">Key message *</label>
              <textarea
                id="briefKey"
                value={form.keyMessage}
                onChange={(e) => {
                  setForm({ ...form, keyMessage: e.target.value });
                  setErrors((er) => ({ ...er, keyMessage: false }));
                }}
                className={errors.keyMessage ? 'error' : ''}
                placeholder="The one idea this piece must land…"
              />
            </div>
            <div className="field">
              <label htmlFor="briefNotes">Extra notes</label>
              <textarea
                id="briefNotes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Assets, constraints, references…"
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Submitting…' : 'Submit brief'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3 className="card-title">Submitted briefs</h3>
        <p className="card-sub">{data.briefs.length} on file</p>
        {data.briefs.length === 0 ? (
          <div className="empty-state">
            <strong>No briefs yet</strong>
            Submit a campaign or post brief above to get started.
          </div>
        ) : (
          <div className="list">
            {data.briefs.map((b) => (
              <div key={b.id} className="list-item">
                <div className="list-item-body">
                  <div className="list-item-title">{b.title}</div>
                  <div className="list-item-meta">
                    <span>{b.platform}</span>
                    <span>{b.tone}</span>
                    {b.deadline && <span>Due {b.deadline}</span>}
                    <span>
                      {new Date(b.createdAt).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                    {b.keyMessage}
                  </p>
                </div>
                <div className="list-item-actions">
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDelete(b.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
