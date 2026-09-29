import { useState, type FormEvent } from 'react';
import type { AppData, GoalsData } from '../../lib/types';
import { useToast } from '../Toast';

const PLATFORMS = ['Instagram', 'LinkedIn', 'X/Twitter', 'YouTube', 'Email', 'Other'];
const KPIS = [
  'Engagement rate',
  'Leads generated',
  'Website traffic',
  'Follower growth',
  'Conversion rate',
  'Brand awareness',
];

interface Props {
  data: AppData;
  onSave: (goals: GoalsData) => void;
}

export function Goals({ data, onSave }: Props) {
  const { toast } = useToast();
  const [form, setForm] = useState<GoalsData>({
    ...data.goals,
    platforms: [...data.goals.platforms],
  });
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  function togglePlatform(p: string) {
    setForm((f) => ({
      ...f,
      platforms: f.platforms.includes(p)
        ? f.platforms.filter((x) => x !== p)
        : [...f.platforms, p],
    }));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!form.objectives.trim()) {
      setError(true);
      toast('Marketing objectives are required.', 'error');
      return;
    }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 300));
    onSave(form);
    setLoading(false);
    toast('Goals saved.');
  }

  function handleReset() {
    if (!window.confirm('Reset goals to defaults?')) return;
    const next: GoalsData = {
      objectives: '',
      primaryKpi: 'Engagement rate',
      monthlyContentVolume: 12,
      platforms: [],
    };
    setForm(next);
    onSave(next);
    toast('Goals reset.', 'info');
  }

  return (
    <div className="card">
      <h3 className="card-title">Marketing goals</h3>
      <p className="card-sub">Set objectives agents optimize toward.</p>
      <form onSubmit={handleSave}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="objectives">Marketing objectives *</label>
            <textarea
              id="objectives"
              value={form.objectives}
              onChange={(e) => {
                setForm({ ...form, objectives: e.target.value });
                setError(false);
              }}
              className={error ? 'error' : ''}
              placeholder="Increase pipeline from content, grow community, launch product awareness…"
            />
          </div>
          <div className="form-grid two">
            <div className="field">
              <label htmlFor="kpi">Primary KPI</label>
              <select
                id="kpi"
                value={form.primaryKpi}
                onChange={(e) => setForm({ ...form, primaryKpi: e.target.value })}
              >
                {KPIS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="volume">Monthly content volume</label>
              <input
                id="volume"
                type="number"
                min={0}
                value={form.monthlyContentVolume}
                onChange={(e) =>
                  setForm({ ...form, monthlyContentVolume: Number(e.target.value) || 0 })
                }
              />
            </div>
          </div>
          <div className="field">
            <label>Priority platforms</label>
            <div className="checkbox-grid">
              {PLATFORMS.map((p) => (
                <label key={p} className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={form.platforms.includes(p)}
                    onChange={() => togglePlatform(p)}
                  />
                  {p}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Saving…' : 'Save goals'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleReset} disabled={loading}>
            Reset
          </button>
        </div>
      </form>
    </div>
  );
}
