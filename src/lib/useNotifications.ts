import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { RelixNotification } from './types';

const POLL_MS = 4000;
const POPUP_MS = 3000;
const seenKey = (pid: string) => `relix.notifPopupSeen.${pid}`;
const readKey = (pid: string) => `relix.notifReadAt.${pid}`;

export interface PopupItem extends RelixNotification {
  popupKey: string;
}

export function useNotifications(projectId: string) {
  const [items, setItems] = useState<RelixNotification[]>([]);
  const [popups, setPopups] = useState<PopupItem[]>([]);
  const [readAt, setReadAt] = useState<string>(() => localStorage.getItem(readKey(projectId)) || '');
  const seenRef = useRef<string | null>(null);

  useEffect(() => {
    seenRef.current = localStorage.getItem(seenKey(projectId));
    setReadAt(localStorage.getItem(readKey(projectId)) || '');
    setItems([]);
    setPopups([]);
  }, [projectId]);

  const load = useCallback(async () => {
    try {
      const res = await api.getNotifications(projectId);
      const list = res.items || [];
      setItems(list);
      const newest = list[0]?.createdAt || res.serverTime;
      const seen = seenRef.current;
      if (!seen) {
        // First visit: don't flood with old notifications
        seenRef.current = newest;
        localStorage.setItem(seenKey(projectId), newest);
        return;
      }
      const fresh = list.filter((n) => n.createdAt > seen).reverse();
      if (fresh.length) {
        seenRef.current = fresh[fresh.length - 1].createdAt;
        localStorage.setItem(seenKey(projectId), seenRef.current);
        const shown = fresh.slice(-4).map((n) => ({ ...n, popupKey: `${n.id}-${Date.now()}` }));
        setPopups((prev) => [...prev, ...shown].slice(-4));
        for (const pItem of shown) {
          window.setTimeout(() => {
            setPopups((prev) => prev.filter((x) => x.popupKey !== pItem.popupKey));
          }, POPUP_MS);
        }
      }
    } catch {
      /* ignore */
    }
  }, [projectId]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, POLL_MS);
    const onChange = () => load();
    window.addEventListener('relix:changed', onChange);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('relix:changed', onChange);
    };
  }, [load]);

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    localStorage.setItem(readKey(projectId), now);
    setReadAt(now);
  }, [projectId]);

  const dismissPopup = useCallback((key: string) => {
    setPopups((prev) => prev.filter((x) => x.popupKey !== key));
  }, []);

  const unread = items.filter((n) => !readAt || n.createdAt > readAt).length;

  return { items, popups, unread, readAt, markAllRead, dismissPopup, reload: load };
}
