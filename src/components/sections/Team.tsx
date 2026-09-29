import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useProject } from '../../lib/ProjectContext';
import type { ProjectTeam, TeamAgent } from '../../lib/types';
import { useToast } from '../Toast';

const ROLE_META: Record<string, { icon: string; blurb: string }> = {
  'Strategy & Calendar': {
    icon: '📅',
    blurb: 'Plans themes, cadences, and calendar slots across priority platforms.',
  },
  'Content Creation': {
    icon: '✍️',
    blurb: 'Drafts posts, threads, scripts, and long-form copy on brief.',
  },
  'Creative/Image': {
    icon: '🎨',
    blurb: 'Produces visual concepts, carousels, and static creative assets.',
  },
  Publishing: {
    icon: '🚀',
    blurb: 'Schedules and ships approved content to connected channels.',
  },
  Analytics: {
    icon: '📊',
    blurb: 'Measures performance, surfaces insights, and flags anomalies.',
  },
  'Marketing Manager': {
    icon: '🎯',
    blurb: 'Orchestrates campaigns, priorities, and handoffs across the agent roster.',
  },
  'Market Research': {
    icon: '🔎',
    blurb: 'Tracks competitors, audience signals, and category trends.',
  },
  Video: {
    icon: '🎬',
    blurb: 'Cuts reels, shorts, and campaign video from source material.',
  },
  'Email/Outreach': {
    icon: '✉️',
    blurb: 'Builds and times nurture sequences and campaign sends.',
  },
  'Call/Sales': {
    icon: '📞',
    blurb: 'Handles outbound and inbound call workflows for qualified leads.',
  },
};

interface Props {
  projectName?: string;
}

function metaFor(role: string) {
  return (
    ROLE_META[role] || {
      icon: '◉',
      blurb: 'Specialized Relix teammate for this project.',
    }
  );
}

export function Team({ projectName = 'this project' }: Props) {
  const { projectId } = useProject();
  const { toast } = useToast();
  const [team, setTeam] = useState<ProjectTeam | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.getTeam(projectId);
      setTeam(res);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load team', 'error');
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => {
    setLoading(true);
    setTeam(null);
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="empty-state">
        <strong>Loading team…</strong>
      </div>
    );
  }

  const agents: TeamAgent[] = team?.agents || [];
  const pending = !team || team.status === 'pending' || agents.length === 0;

  return (
    <div className="section-stack">
      <div className="card">
        <h3 className="card-title">Agents for {projectName}</h3>
        <p className="card-sub">
          {pending
            ? 'Your Relix team is still being provisioned for this project. Refresh in a minute.'
            : `${agents.length} specialized agents for ${team?.channelName || projectName}${
                team?.goal ? ` · Goal: ${team.goal}` : ''
              }.`}
        </p>
      </div>
      {pending ? (
        <div className="empty-state">
          <strong>Team provisioning in progress</strong>
          Relix creates a dedicated agent group for this brand — not shared Sanctum agents.
        </div>
      ) : (
        <div className="team-grid">
          {agents.map((a) => {
            const meta = metaFor(a.role);
            return (
              <div key={a.id || a.name} className="team-card">
                <div className="team-card-header">
                  <div className="team-avatar">{meta.icon}</div>
                  <span className="badge badge-primary">Ready</span>
                </div>
                <h3>{a.name}</h3>
                <p className="list-item-meta" style={{ marginBottom: 8 }}>
                  {a.role}
                </p>
                <p>{meta.blurb}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
