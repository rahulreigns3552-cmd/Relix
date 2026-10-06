import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { RichText } from '../lib/richText';
import { useProject } from '../lib/ProjectContext';
import type {
  ChannelPlatform,
  ChatAttachment,
  ChatConnector,
  ChatWidget,
  NavSection,
} from '../lib/types';

const PREVIEW_FOCUS_KEY = 'relix_previewFocusId';
const CHANNEL_FOCUS_KEY = 'relix_channelFocus';

type Turn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
  jobId?: string;
  attachments?: ChatAttachment[];
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

const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  twitter: 'X',
  youtube: 'YouTube',
  whatsapp: 'WhatsApp',
  email: 'Email',
};

function platformLabel(platform?: string | null) {
  if (!platform) return 'channel';
  return PLATFORM_LABEL[platform] || platform.charAt(0).toUpperCase() + platform.slice(1);
}

function oneLine(text?: string, max = 90) {
  const line = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!line) return 'Open in Preview';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Hide boilerplate when a post card is present; keep channel replies to one short sentence. */
function displayAssistantText(text: string, attachments: ChatAttachment[] = []) {
  let t = String(text || '').trim();
  const hasPreview = attachments.some((a) => a.type === 'ig_preview');
  const hasConnector = attachments.some((a) => a.type === 'connector' && a.connector);
  if (hasPreview) {
    t = t
      .replace(/Open Preview to Approve[^.!?\n]*[.!?]?/gi, '')
      .replace(/Tap (?:below|the card)[^.!?\n]*[.!?]?/gi, '')
      .replace(/\bZernio\b/gi, '')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }
  if (hasConnector) {
    t = t.replace(/\bZernio\b/gi, '').replace(/\s{2,}/g, ' ').trim();
    const first = t.split(/(?<=[.!?])\s+/)[0] || t;
    t = first.slice(0, 140).trim();
    if (!t) {
      const c = attachments.find((a) => a.type === 'connector')?.connector;
      t = `${platformLabel(c?.platform)} isn’t connected for this brand yet.`;
    }
  }
  return t;
}

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
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 4h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H9l-4 3.4V7a3 3 0 0 1 3-3Z"
        fill="currentColor"
      />
      <circle cx="9.2" cy="10" r="1.2" fill="#fff7ed" />
      <circle cx="12.4" cy="10" r="1.2" fill="#fff7ed" />
      <circle cx="15.6" cy="10" r="1.2" fill="#fff7ed" />
    </svg>
  );
}

function CompactIgCard({
  att,
  onOpen,
}: {
  att: ChatAttachment;
  onOpen: () => void;
}) {
  const img = att.imageUrl || att.url;
  return (
    <button type="button" className="rx-float-ig-card" onClick={onOpen} aria-label="Open post in Preview">
      {img ? (
        <img src={img} alt="" />
      ) : (
        <span className="rx-float-ig-fallback" aria-hidden="true">
          ▣
        </span>
      )}
      <span className="rx-float-ig-copy">
        <strong>Instagram draft</strong>
        <span>{oneLine(att.caption)}</span>
      </span>
    </button>
  );
}

function FloatWidget({
  widget,
  onAnswer,
}: {
  widget: ChatWidget;
  onAnswer: (value: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const answered = widget.answered;

  async function pick(value: string) {
    if (answered || busy) return;
    setBusy(value);
    try {
      await onAnswer(value);
    } finally {
      setBusy(null);
    }
  }

  const answeredOpt = answered
    ? widget.options.find((o) => (o.value ?? o.label) === answered.value)
    : undefined;

  return (
    <div className={`rx-float-widget${answered ? ' is-answered' : ''}`}>
      <div className="rx-float-widget-prompt">{widget.prompt}</div>
      {answered ? (
        <div className="rx-float-widget-answer">
          <strong>{answeredOpt?.label || answered.label || answered.value}</strong>
          <span aria-hidden="true">✓</span>
        </div>
      ) : (
        <div className="rx-float-widget-options">
          {widget.options.map((o, i) => {
            const value = o.value ?? o.label;
            return (
              <button
                key={`${widget.id}-${i}`}
                type="button"
                className={`rx-float-widget-opt style-${o.style || 'default'}`}
                disabled={!!busy}
                onClick={() => void pick(value)}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConnectChannelCard({
  connector,
  onConnect,
}: {
  connector: ChatConnector;
  onConnect: () => void;
}) {
  const label = platformLabel(connector.platform);
  const status = connector.status;
  if (status === 'added') {
    return (
      <div className="rx-float-connect is-added">
        <span>✓ {label} connected</span>
      </div>
    );
  }
  if (status === 'connecting') {
    return (
      <div className="rx-float-connect">
        <button type="button" className="rx-float-connect-btn" disabled>
          Connecting {label}…
        </button>
      </div>
    );
  }
  return (
    <div className="rx-float-connect">
      <button type="button" className="rx-float-connect-btn" onClick={onConnect}>
        Connect {label}
      </button>
    </div>
  );
}

async function enrichAttachments(
  projectId: string,
  text: string,
  attachments: ChatAttachment[] | undefined,
): Promise<ChatAttachment[]> {
  const list = [...(attachments || [])];
  if (list.some((a) => a.type === 'ig_preview')) return list;
  const mentionsDraft =
    /preview|approve|draft|today'?s post|scheduled/i.test(text) ||
    /open preview/i.test(text);
  if (!mentionsDraft) return list;
  try {
    const queue = await api.getIgQueue(projectId);
    const pending = (queue.items || []).find(
      (i) => i.status === 'pending' || i.status === 'changes_requested',
    );
    if (!pending) return list;
    list.push({
      type: 'ig_preview',
      postId: pending.id,
      imageUrl: pending.imageUrl,
      caption: pending.caption,
      hashtags: pending.hashtags,
    });
  } catch {
    /* keep text-only */
  }
  return list;
}

interface Props {
  onNavigate: (section: NavSection) => void;
}

export function FloatingChat({ onNavigate }: Props) {
  const { project, projectId } = useProject();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingJobs = useRef<Set<string>>(new Set());
  const capturedLeadKey = useRef('');

  useEffect(() => {
    setTurns([]);
    setDraft('');
    setBusy(false);
    setAwaiting(false);
    pendingJobs.current = new Set();
    capturedLeadKey.current = '';
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
  }, [open, turns, busy, awaiting]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(id);
  }, [open, projectId]);

  useEffect(() => {
    if (!awaiting) return;
    let stop = false;
    async function pullReply() {
      try {
        const thread = await api.getChat(projectId);
        if (stop) return;
        const pending = pendingJobs.current;
        const found: Turn[] = [];
        for (const message of thread.messages || []) {
          if (message.role !== 'assistant' || !message.jobId || !pending.has(message.jobId)) continue;
          const text = message.text?.trim() || '';
          const attachments = await enrichAttachments(projectId, text, message.attachments);
          if (!text && attachments.length === 0) continue;
          found.push({
            id: message.id,
            role: 'assistant',
            text,
            jobId: message.jobId,
            attachments,
          });
          pending.delete(message.jobId);
        }
        if (found.length) {
          setTurns((prev) => {
            const ids = new Set(prev.map((turn) => turn.id));
            return [...prev, ...found.filter((turn) => !ids.has(turn.id))];
          });
        }
        if (pending.size === 0) setAwaiting(false);
      } catch {
        /* Reply is not back yet. Keep "Relix is on it" instead of an error. */
      }
    }
    void pullReply();
    const id = window.setInterval(() => void pullReply(), 2000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [awaiting, projectId]);

  useEffect(() => {
    if (busy || awaiting || turns.length === 0) return;
    let lastUser = -1;
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      if (turns[i].role === 'user') {
        lastUser = i;
        break;
      }
    }
    if (lastUser < 0) return;
    let reply = -1;
    for (let i = lastUser + 1; i < turns.length; i += 1) {
      const turn = turns[i];
      if (turn.role === 'assistant' && !turn.error && turn.text.trim()) {
        reply = i;
        break;
      }
    }
    if (reply < 0) return;
    for (let i = reply + 1; i < turns.length; i += 1) {
      if (turns[i].role === 'user') return;
    }
    const key = `${projectId}:${turns[lastUser].id}:${turns[reply].id}`;
    if (capturedLeadKey.current === key) return;
    capturedLeadKey.current = key;
    void api.captureChatLead(projectId).catch(() => {
      if (capturedLeadKey.current === key) capturedLeadKey.current = '';
    });
  }, [turns, busy, awaiting, projectId]);

  function openPreview(postId?: string) {
    if (postId) {
      try {
        sessionStorage.setItem(PREVIEW_FOCUS_KEY, postId);
      } catch {
        /* ignore */
      }
    }
    onNavigate('preview');
  }

  function openChannels(platform?: string) {
    if (platform) {
      try {
        sessionStorage.setItem(CHANNEL_FOCUS_KEY, platform);
      } catch {
        /* ignore */
      }
    }
    onNavigate('channels');
  }

  async function ask(prompt: string, label?: string) {
    const shown = (label || prompt).trim();
    const sentText = prompt.trim();
    if (!shown || !sentText || busy) return;
    const placeholder = `pending-${Date.now()}`;
    pendingJobs.current.add(placeholder);
    setBusy(true);
    setDraft('');
    setTurns((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: shown }]);
    setAwaiting(true);
    try {
      const sent = await api.sendChat(projectId, sentText);
      pendingJobs.current.delete(placeholder);
      pendingJobs.current.add(sent.jobId);
      try {
        await api.agentReply(projectId, sent.jobId);
      } catch (err) {
        pendingJobs.current.delete(sent.jobId);
        const message = err instanceof Error ? err.message : 'Agent reply failed';
        setTurns((prev) => [
          ...prev,
          { id: `e-${Date.now()}`, role: 'assistant', text: message, error: true },
        ]);
        if (pendingJobs.current.size === 0) setAwaiting(false);
      }
    } catch {
      pendingJobs.current.delete(placeholder);
      if (pendingJobs.current.size === 0) setAwaiting(false);
      setTurns((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: 'assistant', text: 'Could not send that just now.', error: true },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function handleWidgetAnswer(messageId: string, widgetId: string, value: string) {
    try {
      const res = await api.answerChatWidget(projectId, { messageId, widgetId, value });
      const shown = value.trim();
      setTurns((prev) => {
        const next = prev.map((t) => {
          if (t.id !== messageId || !t.attachments) return t;
          return {
            ...t,
            attachments: t.attachments.map((a) => {
              if (a.type !== 'widget' || !a.widget || a.widget.id !== widgetId) return a;
              return {
                ...a,
                widget: {
                  ...a.widget,
                  answered: { value, label: value, at: new Date().toISOString() },
                },
              };
            }),
          };
        });
        return [...next, { id: `u-${Date.now()}`, role: 'user' as const, text: shown }];
      });
      if (res.jobId) {
        pendingJobs.current.add(res.jobId);
        setAwaiting(true);
        try {
          await api.agentReply(projectId, res.jobId);
        } catch (err) {
          pendingJobs.current.delete(res.jobId);
          const message = err instanceof Error ? err.message : 'Agent reply failed';
          setTurns((prev) => [
            ...prev,
            { id: `e-${Date.now()}`, role: 'assistant', text: message, error: true },
          ]);
          if (pendingJobs.current.size === 0) setAwaiting(false);
        }
      }
    } catch {
      setTurns((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: 'assistant', text: 'Could not send that answer.', error: true },
      ]);
    }
  }

  async function handleConnectorAction(messageId: string, connector: ChatConnector) {
    const platform = connector.platform as ChannelPlatform | undefined;
    openChannels(platform);
    try {
      const res = await api.chatConnectorAction(projectId, {
        messageId,
        connectorId: connector.id,
      });
      if (res.authUrl) window.location.assign(res.authUrl);
    } catch {
      /* Channels section still opens; URL can be pasted there. */
    }
  }

  function renderAttachments(turn: Turn): ReactNode {
    const atts = turn.attachments || [];
    if (!atts.length) return null;
    return (
      <div className="rx-float-atts">
        {atts.map((att, i) => {
          const key = `${turn.id}-att-${i}`;
          if (att.type === 'ig_preview') {
            return (
              <CompactIgCard
                key={key}
                att={att}
                onOpen={() => openPreview(att.postId)}
              />
            );
          }
          if (att.type === 'connector' && att.connector) {
            return (
              <ConnectChannelCard
                key={key}
                connector={att.connector}
                onConnect={() => void handleConnectorAction(turn.id, att.connector!)}
              />
            );
          }
          if (att.type === 'widget' && att.widget) {
            return (
              <FloatWidget
                key={key}
                widget={att.widget}
                onAnswer={(value) => handleWidgetAnswer(turn.id, att.widget!.id, value)}
              />
            );
          }
          if (att.type === 'image' && (att.url || att.imageUrl)) {
            return (
              <div key={key} className="rx-float-image">
                <img src={att.url || att.imageUrl} alt={att.name || 'Attachment'} />
              </div>
            );
          }
          return null;
        })}
      </div>
    );
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
                {turns.map((turn) => {
                  const shown =
                    turn.role === 'assistant' && !turn.error
                      ? displayAssistantText(turn.text, turn.attachments)
                      : turn.text;
                  return (
                    <div
                      key={turn.id}
                      className={`rx-float-turn is-${turn.role}${turn.error ? ' is-error' : ''}`}
                    >
                      {shown ? (
                        <div className="rx-float-turn-text">
                          {turn.role === 'assistant' && !turn.error ? <RichText text={shown} /> : shown}
                        </div>
                      ) : null}
                      {turn.role === 'assistant' ? renderAttachments(turn) : null}
                    </div>
                  );
                })}
                {awaiting && (
                  <div className="rx-float-turn is-assistant is-waiting">Relix is on it</div>
                )}
              </div>
            )}
            {turns.length === 0 && awaiting && (
              <div className="rx-float-turn is-assistant is-waiting">Relix is on it</div>
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
