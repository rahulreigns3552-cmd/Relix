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
    id: 'today',
    label: "See today's post",
    hint: 'What is scheduled to go out',
    prompt: "Show me today's post for this brand, including the caption and where it is scheduled.",
    icon: 'today',
    layout: 'feature',
  },
  {
    id: 'review',
    label: 'Approve or reject a draft',
    hint: 'Say yes, or send it back',
    prompt: 'Show me the draft waiting for a decision so I can approve or reject it.',
    icon: 'review',
    layout: 'tile',
  },
  {
    id: 'ig',
    label: 'Connect Instagram',
    hint: 'Link the brand account',
    prompt: 'Help me connect Instagram for this brand. What is still missing, and what should I do next?',
    icon: 'ig',
    layout: 'tile',
  },
  {
    id: 'next',
    label: 'Ask Relix what to post next',
    hint: 'One idea in this brand’s voice',
    prompt: 'What should we post next for this brand? Suggest one idea that fits our voice and goals.',
    icon: 'next',
    layout: 'ask',
  },
] as const;

function OptionIcon({ name }: { name: (typeof OPTIONS)[number]['icon'] }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': true as const,
  };
  if (name === 'today') {
    return (
      <svg {...common}>
        <rect x="4" y="5" width="16" height="15" rx="3" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 3.5v3M16 3.5v3M4 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M9 14.2h2.2M12.8 14.2H15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'review') {
    return (
      <svg {...common}>
        <path d="M8 12.2 10.4 14.6 15.2 9.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 7.5h9.2A4.8 4.8 0 0 1 19 12.3V17a2 2 0 0 1-2 2H8.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M5 7.5 7.4 5M5 7.5l2.4 2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'ig') {
    return (
      <svg {...common}>
        <rect x="4" y="4" width="16" height="16" rx="5" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="16.6" cy="7.4" r="0.9" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 3.2 13.7 9l5.6 1.5L13.7 12 12 17.8 10.3 12 4.7 10.5 10.3 9 12 3.2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M18.2 15.5 19 17.4l1.8.7-1.8.8-.8 1.9-.8-1.9-1.8-.8 1.8-.7.8-1.9Z" fill="currentColor" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg className="rx-float-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 3.5 11 8l-5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
          className="rx-float-panel"
          role="dialog"
          aria-label={`Relix for ${project.name}`}
        >
          <header className="rx-float-welcome">
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
            <h2>Welcome to Relix</h2>
            <p>Your brand workspace for posts, approvals, and channels.</p>
          </header>

          <div className="rx-float-body" ref={listRef}>
            <div className="rx-float-options" role="group" aria-label="Chat options">
              {OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`rx-float-option is-${opt.layout}`}
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
                  {(opt.layout === 'feature' || opt.layout === 'ask') && <Chevron />}
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
              placeholder="Type a question…"
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
          <svg width="24" height="24" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
