import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { BrandData, Project } from '../lib/types';

const GOALS = [
  'Grow my brand',
  'Get more leads',
  'Create social media content',
  'Launch a product',
  'Increase sales',
  'Manage multiple brands',
] as const;

function isUrlish(value: string): boolean {
  const s = value.trim();
  if (!s) return true;
  try {
    const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    const u = new URL(withProto);
    return Boolean(u.hostname && u.hostname.includes('.'));
  } catch {
    return false;
  }
}

export interface OnboardingResult {
  project: Project;
  brand: BrandData;
  goal: string;
  provisionJobId: string;
}

interface Props {
  email: string;
  onComplete: (result: OnboardingResult) => void;
}

export function OnboardingModal({ email, onComplete }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [goal, setGoal] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [website, setWebsite] = useState('');
  const [industry, setIndustry] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleNext() {
    setError('');
    if (!goal) {
      setError('Pick what you want to achieve.');
      return;
    }
    setStep(2);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!businessName.trim()) {
      setError('Business name is required.');
      return;
    }
    if (!industry.trim()) {
      setError('Industry is required.');
      return;
    }
    if (website.trim() && !isUrlish(website)) {
      setError('Website should look like a URL (e.g. example.com).');
      return;
    }

    setLoading(true);
    try {
      const res = await api.completeOnboarding({
        email,
        goal,
        businessName: businessName.trim(),
        website: website.trim(),
        industry: industry.trim(),
      });
      onComplete({
        project: res.project,
        brand: res.brand,
        goal: res.goals?.objectives || goal,
        provisionJobId: res.provisionJobId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onboarding failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="modal-card onboarding-modal">
        <div className="modal-header">
          <span className="modal-step">Step {step} of 2</span>
          <h2 id="onboarding-title">
            {step === 1 ? 'What do you want to achieve with Relix?' : 'Tell us about your business'}
          </h2>
        </div>

        {error && <div className="form-error">{error}</div>}

        {step === 1 ? (
          <div className="onboarding-goals">
            {GOALS.map((g) => (
              <button
                key={g}
                type="button"
                className={`onboarding-goal${goal === g ? ' selected' : ''}`}
                onClick={() => setGoal(g)}
              >
                {g}
              </button>
            ))}
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={handleNext} disabled={!goal}>
                Next
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-grid" style={{ marginBottom: 16 }}>
              <div className="field">
                <label htmlFor="biz-name">Business name</label>
                <input
                  id="biz-name"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Acme Co"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="biz-website">
                  Website <span className="field-optional">(optional)</span>
                </label>
                <input
                  id="biz-website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="example.com"
                />
              </div>
              <div className="field">
                <label htmlFor="biz-industry">Industry</label>
                <input
                  id="biz-industry"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="e.g. Beauty, SaaS, Fitness"
                  required
                />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(1)} disabled={loading}>
                Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Setting up…' : 'Submit'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
