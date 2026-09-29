import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { Project, Session } from '../lib/types';

const ICONS: Record<string, string> = {
  sanctum: 'SA',
  sciens: 'SC',
};

interface Props {
  session: Session;
  onOpen: (project: Project) => void;
  onLogout: () => void;
}

export function Projects({ session, onOpen, onLogout }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [industry, setIndustry] = useState('');
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);

  async function loadProjects() {
    try {
      const res = await api.listProjects(session.email);
      setProjects(res.projects || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await api.listProjects(session.email);
        if (!cancelled) {
          setProjects(res.projects || []);
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load projects');
          setProjects([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function closeModal() {
    setShowAdd(false);
    setName('');
    setDescription('');
    setWebsite('');
    setIndustry('');
    setFormError('');
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Project name is required.');
      return;
    }
    setCreating(true);
    try {
      const res = await api.createProject({
        name: trimmed,
        description: description.trim() || undefined,
        website: website.trim() || undefined,
        industry: industry.trim() || undefined,
        email: session.email,
        ownerEmail: session.email,
      });
      closeModal();
      await loadProjects();
      onOpen(res.project);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="projects-page">
      <header className="projects-header">
        <div className="projects-header-brand">
          <div className="sidebar-logo">RX</div>
          <div>
            <strong>Relix</strong>
            <span>Choose a project workspace</span>
          </div>
        </div>
        <div className="projects-header-actions">
          <span className="projects-user">{session.email}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Log out"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onLogout();
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <main className="projects-main">
        <div className="projects-intro projects-intro-row">
          <div>
            <h1>Projects</h1>
            <p>Open a project to manage chat, brand, goals, and Instagram drafts in isolation.</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
            Add project
          </button>
        </div>

        {loading ? (
          <div className="empty-state">
            <strong>Loading projects…</strong>
          </div>
        ) : (
          <>
            {error && (
              <div className="form-error" style={{ marginBottom: 16, maxWidth: 640 }}>
                API: {error} — showing local defaults.
              </div>
            )}
            <div className="projects-grid">
              {projects.map((p) => (
                <article key={p.id} className="project-card">
                  <div className="project-card-top">
                    <div className={`project-icon project-icon-${p.id}`}>
                      {ICONS[p.id] || p.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h2>{p.name}</h2>
                      <span className="project-id">{p.id}</span>
                    </div>
                  </div>
                  <p className="project-blurb">{p.description}</p>
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    onClick={() => onOpen(p)}
                  >
                    Open project
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
      </main>

      {showAdd && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="add-project-title">
          <div className="modal-card">
            <div className="modal-header">
              <h2 id="add-project-title">Add project</h2>
              <p className="modal-sub">Create a new Relix workspace for a brand or campaign.</p>
            </div>
            {formError && <div className="form-error">{formError}</div>}
            <form onSubmit={handleCreate}>
              <div className="form-grid" style={{ marginBottom: 16 }}>
                <div className="field">
                  <label htmlFor="proj-name">Name</label>
                  <input
                    id="proj-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Brand or campaign name"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="proj-desc">
                    Description <span className="field-optional">(optional)</span>
                  </label>
                  <input
                    id="proj-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Short blurb"
                  />
                </div>
                <div className="field">
                  <label htmlFor="proj-web">
                    Website <span className="field-optional">(optional)</span>
                  </label>
                  <input
                    id="proj-web"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="example.com"
                  />
                </div>
                <div className="field">
                  <label htmlFor="proj-ind">
                    Industry <span className="field-optional">(optional)</span>
                  </label>
                  <input
                    id="proj-ind"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    placeholder="e.g. Beauty"
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeModal} disabled={creating}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating…' : 'Create project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
