import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { useProject } from '../lib/ProjectContext';

type Turn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
};

const OPTIONS = [
  {
    id: 'draft',
    label: 'Draft a post',
    hint: 'A caption in this brand’s voice',
    prompt: 'Draft a social post for this brand that matches our voice and current goals.',
    icon: 'draft',
  },
  {
    id: 'approval',
    label: 'Check what is waiting for approval',
    hint: 'See items that still need a yes',
    prompt: 'What is waiting for approval on this brand right now?',
    icon: 'check',
  },
  {
    id: 'channel',
    label: 'Connect a channel',
    hint: 'Which accounts still need a link',
    prompt: 'Help me connect a channel for this brand. Which channels are still disconnected, and what should I do next?',
    icon: 'link',
  },
  {
    id: 'brand',
    label: 'Ask about this brand',
    hint: 'Voice, audience, and focus',
    prompt: 'Give me a short brief on this brand: voice, audience, and what we should focus on.',
    icon: 'spark',
  },
] as const;

function OptionIcon({ name }: { name: (typeof OPTIONS)[number]['icon'] }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': true as const,
  };
  if (name === 'draft') {
    return (
      <svg {...common}>
        <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M13.5 6.5l3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'check') {
    return (
      <svg {...common}>
        <rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 12.2 10.6 15 16 9.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'link') {
    return (
      <svg {...common}>
        <path d="M10 13a5 5 0 0 0 7.1.1l1.4-1.4a5 5 0 0 0-7.1-7.1L10 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M14 11a5 5 0 0 0-7.1-.1L5.5 12.3a5 5 0 0 0 7.1 7.1L14 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 3.5 13.6 9l5.4 1.4L13.6 12 12 17.5 10.4 12 5 10.4 10.4 9 12 3.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.2 5.2A3.2 3.2 0 0 1 9.4 2h5.2A3.2 3.2 0 0 1 17.8 5.2v5.1a3.2 3.2 0 0 1-3.2 3.2h-4.2L7 16.8c-.7.6-1.8.1-1.8-.8v-2.2A3.2 3.2 0 0 1 6.2 10.3V5.2Z"
        fill="currentColor"
      />
      <circle cx="9.2" cy="8.4" r="1" fill="#fff7ed" />
      <circle cx="12.2" cy="8.4" r="1" fill="#fff7ed" />
      <circle cx="15.2" cy="8.4" r="1" fill="#fff7ed" />
    </svg>
  );
}

export function FloatingChat() {
  const { project, projectId } = useProject();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setTurns([]);
    setDraft('');
    setBusy(false);
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [open, turns, busy]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(id);
  }, [open, projectId]);

  async function ask(prompt: string, label?: string) {
    const shown = (label || prompt).trim();
    const sentText = prompt.trim();
    if (!shown || !sentText || busy) return;
    setBusy(true);
    setDraft('');
    setTurns((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: shown }]);
    try {
      const sent = await api.sendChat(projectId, sentText);
      try {
        const replied = await api.agentReply(projectId, sent.jobId);
        const messages = replied.chat?.messages || [];
        const assistant = [...messages].reverse().find((m) => m.role === 'assistant' && String(m.text || '').trim());
        setTurns((prev) => [
          ...prev,
          {
            id: assistant?.id || `a-${Date.now()}`,
            role: 'assistant',
            text: assistant?.text?.trim() || 'Relix replied, but the message was empty.',
          },
        ]);
      } catch (err) {
        const msg = err instanceof Error && err.message ? err.message : 'Relix could not reply just now.';
        setTurns((prev) => [...prev, { id: `e-${Date.now()}`, role: 'assistant', text: msg, error: true }]);
      }
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : 'Could not send that just now.';
      setTurns((prev) => [...prev, { id: `e-${Date.now()}`, role: 'assistant', text: msg, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  const ui = (
    <div className={`rx-float${open ? ' is-open' : ''}`}>
      {open && (
        <section
          ref={panelRef}
          className="rx-float-panel"
          role="dialog"
          aria-label={`Relix for ${project.name}`}
        >
          <header className="rx-float-head">
            <div className="rx-float-mark" aria-hidden="true">
              <ChatIcon />
            </div>
            <div className="rx-float-head-copy">
              <strong>Relix</strong>
              <span>{project.name}</span>
            </div>
            <button
              type="button"
              className="rx-float-close"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div className="rx-float-body" ref={listRef}>
            <p className="rx-float-greet">
              Hi — I’m here for <strong>{project.name}</strong>. Pick an option, or ask something of your own.
            </p>
            <div className="rx-float-options" role="group" aria-label="Chat options">
              {OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className="rx-float-option"
                  disabled={busy}
                  onClick={() => void ask(opt.prompt, opt.label)}
                >
                  <span className="rx-float-option-icon">
                    <OptionIcon name={opt.icon} />
                  </span>
                  <span className="rx-float-option-copy">
                    <strong>{opt.label}</strong>
                    <span>{opt.hint}</span>
                  </span>
                </button>
              ))}
            </div>

            {turns.length > 0 && (
              <div className="rx-float-thread" aria-live="polite">
                {turns.map((turn) => (
                  <div key={turn.id} className={`rx-float-turn is-${turn.role}${turn.error ? ' is-error' : ''}`}>
                    {turn.text}
                  </div>
                ))}
                {busy && (
                  <div className="rx-float-turn is-assistant is-typing" aria-label="Relix is working">
                    <span />
                    <span />
                    <span />
                  </div>
                )}
              </div>
            )}
            {turns.length === 0 && busy && (
              <div className="rx-float-turn is-assistant is-typing" aria-label="Relix is working">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>

          <form
            className="rx-float-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(draft);
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              placeholder={`Ask about ${project.name}…`}
              aria-label={`Message Relix about ${project.name}`}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(draft);
                }
              }}
            />
            <button type="submit" className="rx-float-send" disabled={busy || !draft.trim()} aria-label="Send">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 19V6M12 6l-5 5M12 6l5 5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        className="rx-float-launcher"
        aria-label={open ? 'Close Relix chat' : 'Open Relix chat'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ) : (
          <ChatIcon />
        )}
      </button>
    </div>
  );

  return createPortal(ui, document.body);
}
