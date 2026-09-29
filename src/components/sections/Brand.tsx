import { useState, type FormEvent } from 'react';
import type { AppData, BrandData } from '../../lib/types';
import { useToast } from '../Toast';

interface Props {
  data: AppData;
  onSave: (brand: BrandData) => void;
}

export function Brand({ data, onSave }: Props) {
  const { toast } = useToast();
  const [form, setForm] = useState<BrandData>({ ...data.brand });
  const [errors, setErrors] = useState<Partial<Record<keyof BrandData, boolean>>>({});
  const [loading, setLoading] = useState(false);

  function set<K extends keyof BrandData>(key: K, value: BrandData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: false }));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    const nextErrors: typeof errors = {};
    if (!form.brandName.trim()) nextErrors.brandName = true;
    if (!form.industry.trim()) nextErrors.industry = true;
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      toast('Please fill required fields.', 'error');
      return;
    }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 300));
    onSave(form);
    setLoading(false);
    toast('Brand profile saved.');
  }

  function handleReset() {
    if (!window.confirm('Clear all brand fields? This cannot be undone.')) return;
    const empty: BrandData = {
      brandName: '',
      website: '',
      industry: '',
      tagline: '',
      brandVoice: '',
      targetAudience: '',
      competitors: '',
      notes: '',
    };
    setForm(empty);
    onSave(empty);
    toast('Brand fields cleared.', 'info');
  }

  return (
    <div className="card">
      <h3 className="card-title">Brand profile</h3>
      <p className="card-sub">Define how agents speak for and about the brand.</p>
      <form onSubmit={handleSave}>
        <div className="form-grid two">
          <div className="field">
            <label htmlFor="brandName">Brand name *</label>
            <input
              id="brandName"
              value={form.brandName}
              onChange={(e) => set('brandName', e.target.value)}
              className={errors.brandName ? 'error' : ''}
              placeholder="Acme Co."
            />
          </div>
          <div className="field">
            <label htmlFor="website">Website</label>
            <input
              id="website"
              value={form.website}
              onChange={(e) => set('website', e.target.value)}
              placeholder="https://example.com"
            />
          </div>
          <div className="field">
            <label htmlFor="industry">Industry *</label>
            <input
              id="industry"
              value={form.industry}
              onChange={(e) => set('industry', e.target.value)}
              className={errors.industry ? 'error' : ''}
              placeholder="SaaS / Fintech / Retail…"
            />
          </div>
          <div className="field">
            <label htmlFor="tagline">Tagline</label>
            <input
              id="tagline"
              value={form.tagline}
              onChange={(e) => set('tagline', e.target.value)}
              placeholder="Short brand promise"
            />
          </div>
        </div>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <div className="field">
            <label htmlFor="brandVoice">Brand voice</label>
            <textarea
              id="brandVoice"
              value={form.brandVoice}
              onChange={(e) => set('brandVoice', e.target.value)}
              placeholder="Tone, vocabulary, dos and don'ts…"
            />
          </div>
          <div className="field">
            <label htmlFor="targetAudience">Target audience</label>
            <textarea
              id="targetAudience"
              value={form.targetAudience}
              onChange={(e) => set('targetAudience', e.target.value)}
              placeholder="Who you sell to, jobs-to-be-done, segments…"
            />
          </div>
          <div className="field">
            <label htmlFor="competitors">Competitors</label>
            <textarea
              id="competitors"
              value={form.competitors}
              onChange={(e) => set('competitors', e.target.value)}
              placeholder="List competitors and differentiation notes…"
            />
          </div>
          <div className="field">
            <label htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Anything else the team should know…"
            />
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Saving…' : 'Save brand'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleReset} disabled={loading}>
            Reset / clear
          </button>
        </div>
      </form>
    </div>
  );
}
