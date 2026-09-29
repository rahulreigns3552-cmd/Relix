import { useEffect, useState } from 'react';
import { Login, type LoginSuccessMeta } from './components/Login';
import { Projects } from './components/Projects';
import { Dashboard } from './components/Dashboard';
import { OnboardingModal, type OnboardingResult } from './components/OnboardingModal';
import { ToastProvider } from './components/Toast';
import { ProjectProvider } from './lib/ProjectContext';
import {
  clearSession,
  getActiveProjectId,
  getAppData,
  getSession,
  saveAppData,
  setActiveProjectId,
} from './lib/storage';
import { api } from './lib/api';
import type { AppData, NavSection, Project, Session } from './lib/types';

const KEEP_SECTIONS: NavSection[] = [
  'chat',
  'preview',
  'analytics',
  'overview',
  'goals',
  'channels',
  'brief',
  'settings',
  'notifications',
];

function AppInner() {
  const [session, setSessionState] = useState<Session | null>(() => getSession());
  const [project, setProject] = useState<Project | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [section, setSection] = useState<NavSection>('chat');
  const [pendingIgCount, setPendingIgCount] = useState(0);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  // Restore active project from localStorage after login
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      const s = getSession();
      setSessionState(s);
      if (!s) {
        setBootstrapping(false);
        return;
      }
      const savedId = getActiveProjectId();
      if (!savedId) {
        setBootstrapping(false);
        return;
      }
      try {
        const res = await api.listProjects(s.email);
        const found = (res.projects || []).find((p) => p.id === savedId);
        if (!cancelled && found) {
          setProject(found);
          setData(getAppData(found.id));
          setSection('chat');
        } else if (!cancelled) {
          setActiveProjectId(null);
        }
      } catch {
        if (!cancelled) setActiveProjectId(null);
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    }
    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session || !project) {
      setPendingIgCount(0);
      return;
    }
    let cancelled = false;
    async function poll() {
      try {
        const queue = await api.getIgQueue(project!.id);
        if (!cancelled) {
          setPendingIgCount(
            (queue.items || []).filter((i) => i.status === 'pending').length
          );
        }
      } catch {
        /* ignore */
      }
    }
    poll();
    const id = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [session, project]);

  function handleLogin(s: Session, meta?: LoginSuccessMeta) {
    setSessionState(s);
    setProject(null);
    setData(null);
    setActiveProjectId(null);
    setNeedsOnboarding(Boolean(meta?.isNewSignup));
  }

  function handleLogout() {
    clearSession();
    setSessionState(null);
    setProject(null);
    setData(null);
    setSection('chat');
    setPendingIgCount(0);
    setNeedsOnboarding(false);
    // Hard remount so no in-memory state can keep the dashboard open
    window.location.replace('/');
  }

  function handleOpenProject(p: Project) {
    setActiveProjectId(p.id);
    setProject(p);
    setData(getAppData(p.id));
    setSection('chat');
  }

  function handleOnboardingComplete(result: OnboardingResult) {
    setNeedsOnboarding(false);
    const base = getAppData(result.project.id);
    const seeded = saveAppData(result.project.id, {
      ...base,
      brand: {
        ...base.brand,
        ...result.brand,
        brandName: result.brand.brandName || result.project.name,
      },
      goals: {
        ...base.goals,
        objectives: result.goal,
      },
    });
    setActiveProjectId(result.project.id);
    setProject(result.project);
    setData(seeded);
    setSection('chat');
  }

  function handleSwitchProject(p: Project) {
    if (project?.id === p.id) return;
    setActiveProjectId(p.id);
    setProject(p);
    setData(getAppData(p.id));
    setPendingIgCount(0);
    setSection((prev) => (KEEP_SECTIONS.includes(prev) ? prev : 'chat'));
  }

  function handleBackToProjects() {
    setActiveProjectId(null);
    setProject(null);
    setData(null);
    setPendingIgCount(0);
  }

  function handleUpdate(patch: Partial<AppData>) {
    if (!project) return;
    const labels: Record<string, [string, string]> = {
      goals: ['Goals updated', 'goals'],
      channels: ['Channels updated', 'channels'],
      briefs: ['Brief updated', 'brief'],
    };
    for (const key of Object.keys(patch)) {
      const l = labels[key];
      if (l) api.addNotification(project.id, { title: l[0], kind: 'info', section: l[1] }).catch(() => {});
    }
    setData((prev) => {
      const base = prev || getAppData(project.id);
      return saveAppData(project.id, { ...base, ...patch });
    });
  }

  if (bootstrapping) {
    return (
      <div className="login-page">
        <div className="empty-state">
          <strong>Loading Relix…</strong>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Login onSuccess={handleLogin} />;
  }

  if (needsOnboarding) {
    return (
      <>
        <div className="login-page">
          <div className="empty-state">
            <strong>Welcome to Relix</strong>
            <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>
              A few quick questions to set up your workspace.
            </p>
          </div>
        </div>
        <OnboardingModal email={session.email} onComplete={handleOnboardingComplete} />
      </>
    );
  }

  if (!project || !data) {
    return (
      <Projects
        session={session}
        onOpen={handleOpenProject}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <ProjectProvider project={project}>
      <Dashboard
        session={session}
        project={project}
        section={section}
        data={data}
        onNavigate={setSection}
        onLogout={handleLogout}
        onUpdate={handleUpdate}
        onBackToProjects={handleBackToProjects}
        onSwitchProject={handleSwitchProject}
        pendingIgCount={pendingIgCount}
      />
    </ProjectProvider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
