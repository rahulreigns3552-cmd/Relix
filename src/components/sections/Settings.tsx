import { useEffect, useState, type FormEvent } from 'react';
import type { AppData, SettingsConnections, SettingsData } from '../../lib/types';
import { api } from '../../lib/api';
import { useProject } from '../../lib/ProjectContext';
import { useToast } from '../Toast';

interface Props {
  data: AppData;
  onSave: (settings: SettingsData) => void;
  onSaveBrandName: (brandName: string) => void;
}

function connectionHint(status?: { connected: boolean; hint: string }) {
  if (!status?.connected) return 'Not connected. Leave blank to keep a saved key.';
  if (status.hint) return `Connected. Saved key ends in ${status.hint}. Leave blank to keep it.`;
  return 'Connected. Leave blank to keep the saved key.';
}

export function Settings({ data, onSave, onSaveBrandName }: Props) {
  const [brandName, setBrandName] = useState(data.brand?.brandName || '');
  const [brandSaving, setBrandSaving] = useState(false);
  const { projectId, project } = useProject();
  const { toast } = useToast();
  const [form, setForm] = useState<SettingsData>({ ...data.settings });
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [connSaving, setConnSaving] = useState(false);
  const [igAccount, setIgAccount] = useState(data.settings.connections?.instagram.account || '');
  const [waNumber, setWaNumber] = useState(data.settings.connections?.whatsapp.number || '');
  const [fromEmail, setFromEmail] = useState(data.settings.connections?.email.from || '');
  const [igKey, setIgKey] = useState('');
  const [waKey, setWaKey] = useState('');
  const [emailKey, setEmailKey] = useState('');

  useEffect(() => {
    setBrandName(data.brand?.brandName || '');
    setForm({ ...data.settings });
    setIgAccount(data.settings.connections?.instagram.account || '');
    setWaNumber(data.settings.connections?.whatsapp.number || '');
    setFromEmail(data.settings.connections?.email.from || '');
    setIgKey('');
    setWaKey('');
    setEmailKey('');
    api
      .getSettings(projectId)
      .then((s) => {
        const connections = s.connections;
        setForm((prev) => ({
          ...prev,
          webhookUrl: s.webhookUrl || '',
          connections: connections || prev.connections,
        }));
        if (connections) {
          setIgAccount(connections.instagram?.account || '');
          setWaNumber(connections.whatsapp?.number || '');
          setFromEmail(connections.email?.from || '');
        }
      })
      .catch(() => {});
    // Reset when switching projects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!form.displayName.trim()) {
      toast('Display name is required.', 'error');
      return;
    }
    setLoading(true);
    try {
      await api.saveSettings(projectId, form.webhookUrl || '');
      onSave(form);
      toast('Settings saved.');
    } catch (err) {
      onSave(form);
      toast(
        err instanceof Error
          ? `Saved locally; API sync failed: ${err.message}`
          : 'Saved locally.',
        'info'
      );
    } finally {
      setLoading(false);
    }
  }

  function applyConnections(connections: SettingsConnections) {
    setForm((prev) => ({ ...prev, connections }));
    setIgAccount(connections.instagram?.account || '');
    setWaNumber(connections.whatsapp?.number || '');
    setFromEmail(connections.email?.from || '');
    setIgKey('');
    setWaKey('');
    setEmailKey('');
  }

  async function handleConnections(e: FormEvent) {
    e.preventDefault();
    setConnSaving(true);
    try {
      const saved = await api.saveConnections(projectId, {
        instagramApiKey: igKey,
        whatsappApiKey: waKey,
        emailApiKey: emailKey,
        instagramAccount: igAccount,
        whatsappNumber: waNumber,
        fromEmail,
      });
      applyConnections(saved.settings.connections);
      try {
        const tested = await api.testConnections(projectId);
        const summary = tested.results
          .map((r) => {
            const name = r.platform === 'instagram' ? 'Instagram' : r.platform === 'whatsapp' ? 'WhatsApp' : 'Email';
            return `${name}: ${r.message}`;
          })
          .join(' · ');
        toast(`Connections saved. ${summary}`);
      } catch (testErr) {
        toast(
          testErr instanceof Error
            ? `Connections saved. Key check failed: ${testErr.message}`
            : 'Connections saved. Key check failed.',
          'info',
        );
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save connections.', 'error');
    } finally {
      setConnSaving(false);
    }
  }

  async function handleBrand(e: FormEvent) {
    e.preventDefault();
    const name = brandName.trim();
    if (!name) {
      toast('Brand name is required.', 'error');
      return;
    }
    setBrandSaving(true);
    try {
      onSaveBrandName(name);
      await api.saveProjectProfile(projectId, { brandName: name });
      toast('Brand name saved.');
    } catch (err) {
      toast(
        err instanceof Error ? `Saved locally; sync failed: ${err.message}` : 'Saved locally.',
        'info'
      );
    } finally {
      setBrandSaving(false);
    }
  }

  async function handlePassword(e: FormEvent) {
    e.preventDefault();
    if (currentPw !== form.demoPassword) {
      toast('Current password is incorrect.', 'error');
      return;
    }
    if (newPw.length < 6) {
      toast('New password must be at least 6 characters.', 'error');
      return;
    }
    if (newPw !== confirmPw) {
      toast('New passwords do not match.', 'error');
      return;
    }
    setPwLoading(true);
    await new Promise((r) => setTimeout(r, 300));
    const next = { ...form, demoPassword: newPw };
    setForm(next);
    onSave(next);
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
    setPwLoading(false);
    toast('Demo password updated. Use it on next login.');
  }

  return (
    <div className="section-stack">
      <div className="card">
        <h3 className="card-title">Brand</h3>
        <p className="card-sub">The brand name Relix uses for {project.name}.</p>
        <form onSubmit={handleBrand}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="brandNameSetting">Brand name</label>
            <input
              id="brandNameSetting"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="Your brand name"
            />
          </div>
          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={brandSaving || !brandName.trim() || brandName.trim() === (data.brand?.brandName || '')}
            >
              {brandSaving ? 'Saving…' : 'Save brand name'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3 className="card-title">Connections</h3>
        <p className="card-sub">
          Relix uses these to send and post for this brand. You can change them later.
        </p>
        <form onSubmit={handleConnections}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="igAccount">Instagram account</label>
            <input
              id="igAccount"
              value={igAccount}
              onChange={(e) => setIgAccount(e.target.value)}
              placeholder="Account name"
              autoComplete="off"
            />
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="igApiKey">Instagram API key</label>
            <input
              id="igApiKey"
              type="password"
              value={igKey}
              onChange={(e) => setIgKey(e.target.value)}
              placeholder="Instagram API key"
              autoComplete="new-password"
            />
            <span className="field-hint">{connectionHint(form.connections?.instagram)}</span>
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="waNumber">WhatsApp number</label>
            <input
              id="waNumber"
              value={waNumber}
              onChange={(e) => setWaNumber(e.target.value)}
              placeholder="WhatsApp number"
              autoComplete="off"
            />
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="waApiKey">WhatsApp API key</label>
            <input
              id="waApiKey"
              type="password"
              value={waKey}
              onChange={(e) => setWaKey(e.target.value)}
              placeholder="WhatsApp API key"
              autoComplete="new-password"
            />
            <span className="field-hint">{connectionHint(form.connections?.whatsapp)}</span>
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="fromEmail">From email</label>
            <input
              id="fromEmail"
              type="email"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder="From email"
              autoComplete="off"
            />
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="emailApiKey">Email API key</label>
            <input
              id="emailApiKey"
              type="password"
              value={emailKey}
              onChange={(e) => setEmailKey(e.target.value)}
              placeholder="Email API key"
              autoComplete="new-password"
            />
            <span className="field-hint">{connectionHint(form.connections?.email)}</span>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={connSaving}>
              {connSaving ? 'Saving…' : 'Save connections'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3 className="card-title">Preferences</h3>
        <p className="card-sub">Local panel settings for {project.name}.</p>
        <form onSubmit={handleSave}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="displayName">Display name</label>
            <input
              id="displayName"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="webhookUrl">Webhook URL (optional)</label>
            <input
              id="webhookUrl"
              type="url"
              placeholder="https://example.com/ops-lead-wakeup"
              value={form.webhookUrl || ''}
              onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
            />
            <span className="field-hint">
              Fire-and-forget ping on new chat messages or Instagram actions. Leave blank to skip.
            </span>
          </div>
          <div className="divider" />
          <div className="toggle-row">
            <div className="toggle-row-text">
              <strong>Email notifications</strong>
              <span>Digest and approval alerts via email</span>
            </div>
            <button
              type="button"
              className={`toggle ${form.emailNotifications ? 'on' : ''}`}
              onClick={() =>
                setForm({ ...form, emailNotifications: !form.emailNotifications })
              }
              aria-label="Toggle email notifications"
            />
          </div>
          <div className="toggle-row">
            <div className="toggle-row-text">
              <strong>Push notifications</strong>
              <span>Browser push for urgent approvals</span>
            </div>
            <button
              type="button"
              className={`toggle ${form.pushNotifications ? 'on' : ''}`}
              onClick={() => setForm({ ...form, pushNotifications: !form.pushNotifications })}
              aria-label="Toggle push notifications"
            />
          </div>
          <div className="toggle-row">
            <div className="toggle-row-text">
              <strong>Weekly digest</strong>
              <span>Summary of agent activity every Monday</span>
            </div>
            <button
              type="button"
              className={`toggle ${form.weeklyDigest ? 'on' : ''}`}
              onClick={() => setForm({ ...form, weeklyDigest: !form.weeklyDigest })}
              aria-label="Toggle weekly digest"
            />
          </div>
          <div className="toggle-row">
            <div className="toggle-row-text">
              <strong>Confirm before proceed</strong>
              <span>Ask for confirmation on approve / reject / destructive actions</span>
            </div>
            <button
              type="button"
              className={`toggle ${form.confirmBeforeProceed ? 'on' : ''}`}
              onClick={() =>
                setForm({ ...form, confirmBeforeProceed: !form.confirmBeforeProceed })
              }
              aria-label="Toggle confirm before proceed"
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3 className="card-title">Change password</h3>
        <p className="card-sub">
          Updates the stored demo password used for login (local only).
        </p>
        <form onSubmit={handlePassword}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="currentPw">Current password</label>
              <input
                id="currentPw"
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="form-grid two">
              <div className="field">
                <label htmlFor="newPw">New password</label>
                <input
                  id="newPw"
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="field">
                <label htmlFor="confirmPw">Confirm new password</label>
                <input
                  id="confirmPw"
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-secondary" disabled={pwLoading}>
              {pwLoading ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
