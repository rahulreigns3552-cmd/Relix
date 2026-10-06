import { createContext, useContext, type ReactNode } from 'react';
import type { Project } from './types';

interface ProjectContextValue {
  project: Project;
  projectId: string;
  viewerEmail: string;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({
  project,
  viewerEmail,
  children,
}: {
  project: Project;
  viewerEmail: string;
  children: ReactNode;
}) {
  return (
    <ProjectContext.Provider value={{ project, projectId: project.id, viewerEmail }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error('useProject must be used within ProjectProvider');
  }
  return ctx;
}
