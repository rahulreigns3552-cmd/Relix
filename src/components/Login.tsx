import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { DEMO_CREDENTIALS, setSession } from '../lib/storage';
import type { Session } from '../lib/types';

export interface LoginSuccessMeta {
  isNewSignup?: boolean;
}

interface Props {
  onSuccess: (session: Session, meta?: LoginSuccessMeta) => void;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function Login({ onSuccess }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function switchMode(next: 'login' | 'signup') {
    setMode(next);
    setError('');
    setConfirmPassword('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !password) {
      setError('Email and password are required.');
      return;
    }
    if (!looksLikeEmail(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }

    if (mode === 'signup') {
      if (password.length <= 6) {
        setError('Password must be more than 6 characters.');
        return;
      }
      if (confirmPassword && confirmPassword !== password) {
        setError('Passwords do not match.');
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'signup') {
        const sessionPayload = await api.signup(trimmed, password);
        const session = setSession(sessionPayload.email);
        onSuccess(session, { isNewSignup: true });
      } else {
        const sessionPayload = await api.login(trimmed, password);
        const session = setSession(sessionPayload.email);
        onSuccess(session, { isNewSignup: false });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo">RX</div>
          <h1>Relix</h1>
          <p>Agent team control panel</p>
        </div>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={handleSubmit} autoComplete="off">
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={error && !email.trim() ? 'error' : ''}
                placeholder="you@company.com"
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={error && !password ? 'error' : ''}
                placeholder="••••••••"
              />
            </div>
            {mode === 'signup' && (
              <div className="field">
                <label htmlFor="confirmPassword">Confirm password</label>
                <input
                  id="confirmPassword"
                  type="password"
                  autoComplete="off"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            )}
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading
              ? mode === 'signup'
                ? 'Creating account…'
                : 'Signing in…'
              : mode === 'signup'
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        {mode === 'login' ? (
          <p className="login-switch">
            Don&apos;t have an account?{' '}
            <button type="button" className="login-signup-link" onClick={() => switchMode('signup')}>
              Sign up
            </button>
          </p>
        ) : (
          <p className="login-switch">
            Already have an account?{' '}
            <button type="button" className="login-signup-link" onClick={() => switchMode('login')}>
              Sign in
            </button>
          </p>
        )}

        {mode === 'login' && (
          <div className="login-hint">
            Demo credentials:{' '}
            <code>{DEMO_CREDENTIALS.email}</code> / <code>{DEMO_CREDENTIALS.password}</code>
          </div>
        )}
      </div>
    </div>
  );
}
