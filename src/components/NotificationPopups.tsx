import type { PopupItem } from '../lib/useNotifications';
import { kindIcon } from './sections/Notifications';

interface Props {
  popups: PopupItem[];
  onOpen: (n: PopupItem) => void;
  onDismiss: (key: string) => void;
}

export function NotificationPopups({ popups, onOpen, onDismiss }: Props) {
  if (!popups.length) return null;
  return (
    <div className="notif-popup-stack" aria-live="polite">
      {popups.map((n) => (
        <div
          key={n.popupKey}
          className={`notif-popup notif-${n.kind}`}
          role="status"
          onClick={() => onOpen(n)}
        >
          <span className="notif-icon">{kindIcon(n.kind)}</span>
          <div className="notif-popup-text">
            <strong>{n.title}</strong>
            {n.body && <span>{n.body}</span>}
          </div>
          <button
            type="button"
            className="notif-popup-close"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(n.popupKey);
            }}
          >
            ×
          </button>
          <span className="notif-popup-timer" />
        </div>
      ))}
    </div>
  );
}
