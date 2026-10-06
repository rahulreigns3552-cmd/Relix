import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { Login, type LoginSuccessMeta } from './components/Login';
import { Projects } from './components/Projects';
import { Dashboard } from './components/Dashboard';
import { OnboardingModal, type OnboardingResult } from './components/OnboardingModal';
import { ToastProvider } from './components/Toast';
import { ProjectProvider } from './lib/ProjectContext';
import { clearSession, setActiveProjectId } from './lib/storage';
import { api } from './lib/api';
import type { NavSection, Project, Session } from './lib/types';

const SECTIONS: NavSection[] = [
  'chat',
  'preview',
  'analytics',
  'notifications',
  'goals',
  'channels',
  'brief',
  'settings',
];

function isSection(value: string | undefined): value is NavSection {
  return SECTIONS.includes(value as NavSection);
}

function AppInner() {
  const navigate = useNavigate();
  const [session, setSessionState] = useState<Session | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((next) => {
        if (!cancelled) setSessionState(next);
      })
      .catch(() => {
        if (!cancelled) setSessionState(null);
      })
      .finally(() => {
        if (!cancelled) setBootstrapping(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleLogin(next: Session, meta?: LoginSuccessMeta) {
    setSessionState(next);
    setActiveProjectId(null);
    navigate(meta?.isNewSignup ? '/onboarding' : '/projects', { replace: true });
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      /* cookie clear is best-effort */
    }
    clearSession();
    setSessionState(null);
    navigate('/login', { replace: true });
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

  return (
    <Routes>
      <Route
        path="/login"
        element={session ? <Navigate to="/projects" replace /> : <Login onSuccess={handleLogin} />}
      />
      <Route
        path="/onboarding"
        element={
          session ? (
            <OnboardingScreen
              session={session}
              onComplete={(result) => {
                setActiveProjectId(result.project.id);
                navigate(`/p/${result.project.id}/chat`, { replace: true });
              }}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/projects"
        element={
          session ? (
            <Projects
              session={session}
              onOpen={(project) => {
                setActiveProjectId(project.id);
                navigate(`/p/${project.id}/chat`);
              }}
              onLogout={() => void handleLogout()}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/p/:projectId/:section?"
        element={
          session ? (
            <ProjectRoute
              session={session}
              onSessionPatch={(patch) => setSessionState((prev) => (prev ? { ...prev, ...patch } : prev))}
              onLogout={() => void handleLogout()}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to={session ? '/projects' : '/login'} replace />} />
    </Routes>
  );
}

function OnboardingScreen({
  session,
  onComplete,
}: {
  session: Session;
  onComplete: (result: OnboardingResult) => void;
}) {
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
      <OnboardingModal email={session.email} onComplete={onComplete} />
    </>
  );
}

function ProjectRoute({
  session,
  onLogout,
  onSessionPatch,
}: {
  session: Session;
  onLogout: () => void;
  onSessionPatch: (patch: Partial<Session>) => void;
}) {
  const { projectId = '', section: sectionParam } = useParams();
  const navigate = useNavigate();
  const section: NavSection = isSection(sectionParam) ? sectionParam : 'chat';
  const [project, setProject] = useState<Project | null>(null);
  const [pendingIgCount, setPendingIgCount] = useState(0);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProject(null);
    setMissing(false);
    api
      .getProject(projectId)
      .then((res) => {
        if (cancelled) return;
        setProject(res.project);
        setActiveProjectId(res.project.id);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    async function poll() {
      try {
        const queue = await api.getIgQueue(project!.id);
        if (!cancelled) {
          setPendingIgCount((queue.items || []).filter((item) => item.status === 'pending').length);
        }
      } catch {
        /* ignore */
      }
    }
    void poll();
    const id = window.setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [project]);

  if (missing) return <Navigate to="/projects" replace />;
  if (!project) {
    return (
      <div className="login-page">
        <div className="empty-state">
          <strong>Loading project…</strong>
        </div>
      </div>
    );
  }
  if (!isSection(sectionParam)) {
    return <Navigate to={`/p/${project.id}/chat`} replace />;
  }

  return (
    <ProjectProvider project={project} viewerEmail={session.email}>
      <Dashboard
        session={session}
        project={project}
        section={section}
        onNavigate={(next) => navigate(`/p/${project.id}/${next}`)}
        onLogout={onLogout}
        onSessionPatch={onSessionPatch}
        onBackToProjects={() => {
          setActiveProjectId(null);
          navigate('/projects');
        }}
        onSwitchProject={(next) => navigate(`/p/${next.id}/${section}`)}
        pendingIgCount={pendingIgCount}
      />
    </ProjectProvider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <AppInner />
      </BrowserRouter>
    </ToastProvider>
  );
}
