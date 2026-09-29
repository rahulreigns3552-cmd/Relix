import type { AppData, ApprovalItem, ApprovalStatus } from '../../lib/types';
import { useToast } from '../Toast';

interface Props {
  data: AppData;
  onSave: (approvals: ApprovalItem[]) => void;
  confirmBeforeProceed: boolean;
}

export function Approvals({ data, onSave, confirmBeforeProceed }: Props) {
  const { toast } = useToast();
  const pending = data.approvals.filter((a) => a.status === 'pending');
  const resolved = data.approvals.filter((a) => a.status !== 'pending');

  function act(id: string, status: ApprovalStatus, label: string) {
    if (confirmBeforeProceed) {
      const ok = window.confirm(`${label} this item?`);
      if (!ok) return;
    }
    const next = data.approvals.map((a) => (a.id === id ? { ...a, status } : a));
    onSave(next);
    toast(
      status === 'approved'
        ? 'Approved.'
        : status === 'rejected'
          ? 'Rejected.'
          : 'Changes requested.',
      status === 'approved' ? 'success' : status === 'rejected' ? 'error' : 'info'
    );
  }

  function restore(id: string) {
    const next = data.approvals.map((a) =>
      a.id === id ? { ...a, status: 'pending' as const } : a
    );
    onSave(next);
    toast('Moved back to pending.', 'info');
  }

  return (
    <div className="section-stack">
      <div className="card">
        <h3 className="card-title">Pending approvals</h3>
        <p className="card-sub">Review work submitted by agent teammates.</p>
        {pending.length === 0 ? (
          <div className="empty-state">
            <strong>All clear</strong>
            No pending approvals. Agents will surface new items here.
          </div>
        ) : (
          <div className="list">
            {pending.map((item) => (
              <div key={item.id} className="list-item">
                <div className="list-item-body">
                  <div className="list-item-title">{item.title}</div>
                  <div className="list-item-meta">
                    <span className="badge badge-primary">{item.type}</span>
                    <span>{item.agentName}</span>
                    <span>
                      {new Date(item.timestamp).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </div>
                </div>
                <div className="list-item-actions">
                  <button
                    type="button"
                    className="btn btn-success btn-sm"
                    onClick={() => act(item.id, 'approved', 'Approve')}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn btn-warning btn-sm"
                    onClick={() => act(item.id, 'changes_requested', 'Request changes on')}
                  >
                    Request changes
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => act(item.id, 'rejected', 'Reject')}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {resolved.length > 0 && (
        <div className="card">
          <h3 className="card-title">Resolved</h3>
          <p className="card-sub">Recently actioned items</p>
          <div className="list">
            {resolved.map((item) => (
              <div key={item.id} className="list-item">
                <div className="list-item-body">
                  <div className="list-item-title">{item.title}</div>
                  <div className="list-item-meta">
                    <span
                      className={`badge ${
                        item.status === 'approved'
                          ? 'badge-success'
                          : item.status === 'rejected'
                            ? 'badge-danger'
                            : 'badge-warning'
                      }`}
                    >
                      {item.status === 'changes_requested'
                        ? 'Changes requested'
                        : item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                    </span>
                    <span>{item.agentName}</span>
                  </div>
                </div>
                <div className="list-item-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => restore(item.id)}
                  >
                    Reopen
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
