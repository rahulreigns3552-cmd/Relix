import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppData, NavSection, Project, Session } from '../lib/types';
import { api } from '../lib/api';
import { Overview } from './sections/Overview';
import { Goals } from './sections/Goals';
import { Channels } from './sections/Channels';
import { Brief } from './sections/Brief';
import { Settings } from './sections/Settings';
import { Chat } from './sections/Chat';
import { Preview } from './sections/Preview';
import { Analytics } from './sections/Analytics';
import { Notifications } from './sections/Notifications';
import { NotificationPopups } from './NotificationPopups';
import { useNotifications } from '../lib/useNotifications';

const NAV: { id: NavSection; label: string; icon: string }[] = [
  { id: 'chat', label: 'Ask Relix', icon: '✦' },
  { id: 'preview', label: 'Preview', icon: '▣' },
  { id: 'analytics', label: 'Analytics', icon: '▤' },
  { id: 'notifications', label: 'Notifications', icon: '◔' },
  { id: 'goals', label: 'Goals', icon: '◎' },
  { id: 'channels', label: 'Channels', icon: '⇄' },
  { id: 'brief', label: 'Brief', icon: '✎' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

const TITLES: Record<NavSection, string> = {
  chat: 'Ask Relix',
  preview: 'Instagram Preview',
  analytics: 'Analytics',
  overview: 'Overview',
  brand: 'Brand',
  goals: 'Goals',
  channels: 'Channels',
  brief: 'Brief',
  team: 'Team',
  settings: 'Settings',
  notifications: 'Notifications',
};

interface Props {
  session: Session;
  project: Project;
  section: NavSection;
  data: AppData;
  onNavigate: (s: NavSection) => void;
  onLogout: () => void;
  onUpdate: (patch: Partial<AppData>) => void;
  onBackToProjects: () => void;
  onSwitchProject: (p: Project) => void;
  pendingIgCount?: number;
}

export function Dashboard({
  session,
  project,
  section,
  data,
  onNavigate,
  onLogout,
  onUpdate,
  onBackToProjects,
  onSwitchProject,
  pendingIgCount = 0,
}: Props) {
  const initials = (data.settings.displayName || 'RX')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const projectInitials = project.name.slice(0, 2).toUpperCase();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [switchLabel, setSwitchLabel] = useState<string | null>(null);
  const [switchAnimKey, setSwitchAnimKey] = useState(0);

  const notif = useNotifications(project.id);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const prevProjectId = useRef(project.id);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setProjectsLoading(true);
      try {
        const res = await api.listProjects(session.email);
        if (!cancelled) setProjects(res.projects || []);
      } catch {
        if (!cancelled) setProjects([]);
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (prevProjectId.current === project.id) return;
    prevProjectId.current = project.id;
    setSwitchLabel(project.name);
    setSwitchAnimKey((k) => k + 1);
    const t = window.setTimeout(() => setSwitchLabel(null), 1000);
    return () => window.clearTimeout(t);
  }, [project.id, project.name]);

  const closeDropdown = useCallback(() => setDropdownOpen(false), []);

  useEffect(() => {
    if (!dropdownOpen) return;
    function onPointerDown(e: MouseEvent) {
      const root = dropdownRef.current;
      if (root && !root.contains(e.target as Node)) closeDropdown();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeDropdown();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [dropdownOpen, closeDropdown]);

  function toggleDropdown() {
    setDropdownOpen((o) => !o);
  }

  function handleSelectProject(p: Project) {
    if (p.id === project.id) {
      closeDropdown();
      return;
    }
    closeDropdown();
    onSwitchProject(p);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">RX</div>
          <div className="sidebar-brand-text">
            <strong>Relix</strong>
            <span>Agent control panel</span>
          </div>
        </div>

        <div className="sidebar-project" ref={dropdownRef}>
          <button
            type="button"
            className={`project-chip project-chip-${project.id} project-chip-trigger ${
              dropdownOpen ? 'open' : ''
            }`}
            onClick={toggleDropdown}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleDropdown();
              }
            }}
            aria-haspopup="listbox"
            aria-expanded={dropdownOpen}
            aria-label={`Current project ${project.name}. Open project switcher`}
          >
            <span className="project-chip-avatar">{projectInitials}</span>
            <div className="project-chip-meta">
              <strong>{project.name}</strong>
              <span>Active project</span>
            </div>
            <span className="project-chip-sep" aria-hidden />
            <span className={`project-chip-chevron${dropdownOpen ? ' open' : ''}`} aria-hidden>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M2.5 4.25L6 7.75L9.5 4.25"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>

          {dropdownOpen && (
            <div className="project-dropdown" role="listbox" aria-label="Projects">
              <div className="project-dropdown-label">Switch project</div>
              {projectsLoading && (
                <div className="project-dropdown-empty">Loading…</div>
              )}
              {!projectsLoading && projects.length === 0 && (
                <div className="project-dropdown-empty">No projects</div>
              )}
              {projects.map((p) => {
                const active = p.id === project.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`project-dropdown-item ${active ? 'active' : ''}`}
                    onClick={() => handleSelectProject(p)}
                  >
                    <span className={`project-dropdown-avatar project-chip-${p.id}`}>
                      {p.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="project-dropdown-meta">
                      <strong>{p.name}</strong>
                      <span>{p.description || p.id}</span>
                    </span>
                    {active && (
                      <span className="project-dropdown-check" aria-hidden>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path
                            d="M3 7.2L5.8 10L11 3.5"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                className="project-dropdown-all"
                onClick={() => {
                  closeDropdown();
                  onBackToProjects();
                }}
              >
                View all projects
              </button>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${section === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {item.id === 'notifications' && notif.unread > 0 && section !== 'notifications' && (
                <span key={notif.unread} className="notif-badge">
                  {notif.unread > 99 ? '99+' : notif.unread}
                </span>
              )}
              {item.id === 'preview' && pendingIgCount > 0 && (
                <span
                  className="badge badge-warning"
                  style={{ marginLeft: 'auto', fontSize: 10 }}
                >
                  {pendingIgCount}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">{initials}</div>
            <div className="user-meta">
              <strong>{data.settings.displayName}</strong>
              <span title={session.email}>{session.email}</span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-block btn-sm"
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
      </aside>

      <div className={`main-area ${switchLabel ? 'project-switching' : ''}`}>
        {switchLabel && (
          <div className="project-switch-overlay" key={switchAnimKey} aria-live="polite">
            <div className="project-switch-bloom" />
            <div className="project-switch-grain" aria-hidden />
            <div className="project-switch-wipe" />
            <div className="project-switch-label">
              Switching to <strong>{switchLabel}</strong>
            </div>
            <div className="project-switch-watermark" aria-hidden>
              {switchLabel}
            </div>
          </div>
        )}

        <NotificationPopups
          popups={notif.popups}
          onDismiss={notif.dismissPopup}
          onOpen={(n) => {
            notif.dismissPopup(n.popupKey);
            onNavigate('notifications');
          }}
        />
        <header className="topbar">
          <div className="topbar-title-row">
            <h2 key={section} className="topbar-title">
              {TITLES[section]}
            </h2>
            <span className={`topbar-project-pill project-chip-${project.id}`}>
              {project.name}
            </span>
          </div>
          <div className="status-pill">
            <span className="status-dot" />
            Ready
          </div>
        </header>
        {section !== 'chat' && (
          <div className="app-ambient" aria-hidden="true">
            <span className="chat-ambient-blob chat-ambient-a" />
            <span className="chat-ambient-blob chat-ambient-b" />
            <span className="chat-ambient-blob chat-ambient-c" />
          </div>
        )}
        <main className={`content ${section === 'chat' ? 'chat-content' : ''}`}>
          <div key={project.id} className="project-pane">
            <div key={section} className={`section-pane section-${section}`}>
              {section === 'chat' && <Chat />}
              {section === 'preview' && <Preview />}
              {section === 'analytics' && <Analytics />}
              {section === 'notifications' && (
                <Notifications
                  items={notif.items}
                  readAt={notif.readAt}
                  onMarkRead={notif.markAllRead}
                  onOpenSection={(s) => onNavigate(s as NavSection)}
                />
              )}
              {section === 'overview' && (
                <Overview data={data} onNavigate={onNavigate} />
              )}
              {section === 'goals' && (
                <Goals data={data} onSave={(goals) => onUpdate({ goals })} />
              )}
              {section === 'channels' && (
                <Channels />
              )}
              {section === 'brief' && (
                <Brief data={data} onSave={(briefs) => onUpdate({ briefs })} />
              )}
              {section === 'settings' && (
                <Settings
                  data={data}
                  onSave={(settings) => onUpdate({ settings })}
                  onSaveBrandName={(brandName) =>
                    onUpdate({ brand: { ...data.brand, brandName } })
                  }
                />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
