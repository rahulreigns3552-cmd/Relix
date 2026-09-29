import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { useProject } from '../../lib/ProjectContext';
import { getLocalChat, getSession, saveLocalChat } from '../../lib/storage';
import type { ChatAttachment, ChatConnector, ChatMessage, ChatThread, ChatWidget } from '../../lib/types';
import { useToast } from '../Toast';

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return '';
  }
}

function greetingName() {
  const session = getSession();
  const email = session?.email || '';
  if (!email) return 'there';
  if (email.startsWith('admin@')) return 'Ops';
  const local = email.split('@')[0] || 'there';
  const piece = local.split(/[._+-]/)[0] || local;
  return piece.charAt(0).toUpperCase() + piece.slice(1);
}

/** Seeded Relix intro with no user messages yet → show creative welcome, not a plain bubble. */
function isFreshThread(messages: ChatMessage[]) {
  if (messages.length === 0) return true;
  if (messages.some((m) => m.role === 'user')) return false;
  return messages.every(
    (m) =>
      m.role === 'assistant' &&
      (!m.attachments || m.attachments.length === 0) &&
      /ask me anything/i.test(m.text || ''),
  );
}

function AttachmentView({ att }: { att: ChatAttachment }) {
  if (att.type === 'image' && (att.url || att.imageUrl)) {
    return (
      <div className="chat-attach-image">
        <img src={att.url || att.imageUrl} alt={att.name || 'Attachment'} />
      </div>
    );
  }
  if (att.type === 'pdf' && att.url) {
    return (
      <div className="chat-attach-pdf">
        <a href={att.url} target="_blank" rel="noreferrer" download={att.name}>
          📄 {att.name || 'Download PDF'}
        </a>
      </div>
    );
  }
  if (att.type === 'ig_preview') {
    const tags = (att.hashtags || []).join(' ');
    return (
      <div className="chat-ig-card">
        {att.imageUrl && <img src={att.imageUrl} alt="Instagram draft" />}
        <div className="chat-ig-card-body">
          {att.caption && <div className="caption">{att.caption}</div>}
          {tags && <div className="tags">{tags}</div>}
          <div className="badge badge-primary" style={{ marginTop: 6, width: 'fit-content' }}>
            Instagram draft
          </div>
        </div>
      </div>
    );
  }
  return null;
}

const URL_OR_MD_LINK = /\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}])/g;

function shortDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.length > 32 ? `${url.slice(0, 31)}…` : url;
  }
}

function LinkChip({ href, label }: { href: string; label?: string }) {
  return (
    <a className="chat-link-chip" href={href} target="_blank" rel="noreferrer" title={href}>
      <span className="chat-link-chip-icon" aria-hidden="true">↗</span>
      {label || shortDomain(href)}
    </a>
  );
}

/** Bot text: bare URLs / markdown links become short domain chips instead of long raw strings. */
function BotText({ text }: { text: string }) {
  const parts: (string | ReactNode)[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(URL_OR_MD_LINK)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    if (m[2]) parts.push(<LinkChip key={`l${i++}`} href={m[2]} label={m[1]} />);
    else parts.push(<LinkChip key={`l${i++}`} href={m[3]} />);
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

const LOGO_COLORS = ['#f97316', '#2563eb', '#16a34a', '#db2777', '#7c3aed', '#0891b2', '#dc2626', '#ca8a04'];

function ConnectorLogo({ connector }: { connector: ChatConnector }) {
  const [broken, setBroken] = useState(false);
  if (connector.logoUrl && !broken) {
    return (
      <img className="chat-connector-logo" src={connector.logoUrl} alt="" onError={() => setBroken(true)} />
    );
  }
  const name = connector.name || '?';
  const color = LOGO_COLORS[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % LOGO_COLORS.length];
  return (
    <span className="chat-connector-logo chat-connector-logo-tile" style={{ background: color }} aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function WidgetCard({
  widget,
  onAnswer,
}: {
  widget: ChatWidget;
  onAnswer: (value: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
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
    <div className={`chat-widget${answered ? ' is-answered' : ''}`}>
      <div className="chat-widget-prompt">{widget.prompt}</div>
      {widget.helpText && <div className="chat-widget-help">{widget.helpText}</div>}
      {answered ? (
        <div className="chat-widget-answer" aria-label="Selected answer">
          <span className="chat-widget-answer-text">
            <strong>{answeredOpt?.label || answered.label || answered.value}</strong>
            {answeredOpt?.description && <span>{answeredOpt.description}</span>}
          </span>
          <span className="chat-widget-check" aria-hidden="true">✓</span>
        </div>
      ) : (
        <>
          <div className="chat-widget-options">
            {widget.options.map((o, i) => {
              const value = o.value ?? o.label;
              return (
                <button
                  key={`${widget.id}-${i}`}
                  type="button"
                  className={`chat-widget-option style-${o.style || 'default'}`}
                  disabled={!!busy}
                  onClick={() => void pick(value)}
                >
                  <span className="chat-widget-option-text">
                    <strong>{o.label}</strong>
                    {o.description && <span>{o.description}</span>}
                  </span>
                  {busy === value && <span className="chat-send-spin chat-widget-spin" />}
                </button>
              );
            })}
          </div>
          {widget.allowCustom && (
            <form
              className="chat-widget-custom"
              onSubmit={(e) => {
                e.preventDefault();
                if (custom.trim()) void pick(custom.trim());
              }}
            >
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Or type your own answer…"
                disabled={!!busy}
              />
              <button type="submit" disabled={!!busy || !custom.trim()}>
                Send
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}

function ConnectorCard({
  connector,
  onAction,
}: {
  connector: ChatConnector;
  onAction: (url?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const status = busy && connector.status === 'available' ? 'connecting' : connector.status;

  async function run(withUrl?: string) {
    if (busy) return;
    if (connector.action === 'add_connector' && connector.url && !connector.platform) {
      window.open(connector.url, '_blank', 'noopener,noreferrer');
    }
    setBusy(true);
    try {
      await onAction(withUrl);
    } finally {
      setBusy(false);
    }
  }

  let button: ReactNode;
  if (status === 'added') {
    button = (
      <span className="chat-connector-added">
        <span aria-hidden="true">✓</span> Added
      </span>
    );
  } else if (status === 'connecting') {
    button = (
      <button type="button" className="chat-connector-btn is-connecting" disabled>
        Connecting...
      </button>
    );
  } else if (status === 'failed') {
    button = (
      <button type="button" className="chat-connector-btn is-failed" onClick={() => void run()} disabled={busy}>
        Retry
      </button>
    );
  } else if (status === 'needs_url') {
    button = (
      <span className="chat-connector-hint">Needs URL</span>
    );
  } else {
    button = (
      <button type="button" className="chat-connector-btn" onClick={() => void run()} disabled={busy}>
        Add
      </button>
    );
  }

  const placeholder =
    connector.platform === 'linkedin'
      ? 'https://www.linkedin.com/company/your-brand/'
      : connector.platform === 'instagram'
        ? 'https://www.instagram.com/your-handle/'
        : connector.platform === 'twitter'
          ? 'https://x.com/your-handle'
          : connector.platform === 'youtube'
            ? 'https://www.youtube.com/@your-channel'
            : connector.platform === 'whatsapp'
              ? 'https://wa.me/91XXXXXXXXXX'
              : connector.platform === 'email'
                ? 'you@brand.com'
                : 'Paste the URL';

  return (
    <div className={`chat-connector status-${status}`}>
      <div className="chat-connector-row">
        <ConnectorLogo connector={connector} />
        <div className="chat-connector-copy">
          <strong>{connector.name}</strong>
          {connector.description && <span className="chat-connector-desc">{connector.description}</span>}
          {typeof connector.tools === 'number' && (
            <span className="chat-connector-tools">
              {connector.tools} tool{connector.tools === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="chat-connector-action">{button}</div>
      </div>
      {status === 'needs_url' && (
        <form
          className="chat-connector-url"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) void run(url.trim());
          }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={placeholder}
            aria-label={`${connector.name} URL`}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !url.trim()}>
            {busy ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      )}
      {(status === 'needs_url' || status === 'failed') && connector.error && (
        <div className="chat-connector-error">{connector.error}</div>
      )}
    </div>
  );
}

interface BlockHandlers {
  onWidgetAnswer: (messageId: string, widgetId: string, value: string) => Promise<void>;
  onConnectorAction: (messageId: string, connectorId: string, url?: string) => Promise<void>;
}

function MessageBubble({ msg, handlers }: { msg: ChatMessage; handlers: BlockHandlers }) {
  const atts = msg.attachments || [];
  return (
    <div className={`chat-bubble-row ${msg.role}`}>
      <div className={`chat-bubble ${msg.role}`}>
        {msg.role === 'assistant' ? <BotText text={msg.text} /> : msg.text}
        {atts.length > 0 && (
          <div className="chat-attachments">
            {atts.map((att, i) => {
              const key = `${msg.id}-att-${i}`;
              if (att.type === 'widget' && att.widget) {
                const w = att.widget;
                return (
                  <WidgetCard
                    key={key}
                    widget={w}
                    onAnswer={(value) => handlers.onWidgetAnswer(msg.id, w.id, value)}
                  />
                );
              }
              if (att.type === 'connector' && att.connector) {
                const c = att.connector;
                return (
                  <ConnectorCard
                    key={key}
                    connector={c}
                    onAction={(url) => handlers.onConnectorAction(msg.id, c.id, url)}
                  />
                );
              }
              return <AttachmentView key={key} att={att} />;
            })}
          </div>
        )}
        <div className="chat-meta">{formatTime(msg.createdAt)}</div>
      </div>
    </div>
  );
}

function RelixOrb() {
  return (
    <div className="chat-orb" aria-hidden="true">
      <div className="chat-orb-glow" />
      <div className="chat-orb-ring chat-orb-ring-a" />
      <div className="chat-orb-ring chat-orb-ring-b" />
      <svg className="chat-orb-star" viewBox="0 0 64 64" fill="none">
        <defs>
          <linearGradient id="relixOrbGrad" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
            <stop stopColor="#fdba74" />
            <stop offset="0.45" stopColor="#f97316" />
            <stop offset="1" stopColor="#ea580c" />
          </linearGradient>
          <filter id="relixOrbSoft" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path
          filter="url(#relixOrbSoft)"
          fill="url(#relixOrbGrad)"
          d="M32 4c1.4 10.8 6.4 18.6 14.8 24C38.4 33.4 33.4 41.2 32 52c-1.4-10.8-6.4-18.6-14.8-24C25.6 22.6 30.6 14.8 32 4Z"
        />
        <circle cx="32" cy="28" r="5.5" fill="#fff7ed" opacity="0.95" />
      </svg>
    </div>
  );
}

const SUGGESTIONS = [
  {
    id: 'preview',
    title: 'Review tomorrow’s post',
    blurb: 'Open what’s queued in Preview and tighten the caption',
    prompt: 'Review tomorrow’s Instagram draft for this brand and suggest caption improvements.',
    icon: '✦',
  },
  {
    id: 'calendar',
    title: 'Plan this week',
    blurb: 'Build a short content calendar around our goals',
    prompt: 'Draft a 5-post Instagram week for this brand based on our goals and brand voice.',
    icon: '✎',
  },
  {
    id: 'analytics',
    title: 'What to post next',
    blurb: 'Use recent performance to pick the next creative angle',
    prompt: 'Based on recent Instagram analytics, what should we post next and why?',
    icon: '◉',
  },
] as const;

export function Chat() {
  const { projectId, project } = useProject();
  const { toast } = useToast();
  const [thread, setThread] = useState<ChatThread>(() => {
    return getLocalChat(projectId) || { messages: [], pendingReply: false };
  });
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [agentNotice, setAgentNotice] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const name = useMemo(() => greetingName(), []);

  useEffect(() => {
    setThread(getLocalChat(projectId) || { messages: [], pendingReply: false });
    setText('');
    setAgentNotice('');
    inputRef.current?.focus();
  }, [projectId]);

  const syncFromServer = useCallback(async () => {
    try {
      const data = await api.getChat(projectId);
      setThread(data);
      saveLocalChat(projectId, data);
    } catch {
      /* keep local */
    }
  }, [projectId]);

  useEffect(() => {
    syncFromServer();
    const id = window.setInterval(syncFromServer, 2500);
    return () => window.clearInterval(id);
  }, [syncFromServer]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.messages.length, thread.pendingReply]);

  async function askAgent(jobId?: string) {
    try {
      const replied = await api.agentReply(projectId, jobId);
      setThread(replied.chat);
      saveLocalChat(projectId, replied.chat);
      setAgentNotice('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Agent reply failed';
      setAgentNotice(msg);
      toast(msg, 'error');
    }
  }

  async function sendMessage(value: string) {
    const trimmed = value.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');
    setAgentNotice('');
    try {
      const res = await api.sendChat(projectId, trimmed);
      setThread(res.chat);
      saveLocalChat(projectId, res.chat);
      await askAgent(res.jobId);
    } catch (err) {
      setText(trimmed);
      toast(err instanceof Error ? err.message : 'Failed to send', 'error');
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }
  const blockHandlers: BlockHandlers = {
    onWidgetAnswer: async (messageId, widgetId, value) => {
      try {
        const res = await api.answerChatWidget(projectId, { messageId, widgetId, value });
        setThread(res.chat);
        saveLocalChat(projectId, res.chat);
        if (res.jobId) await askAgent(res.jobId);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not send answer', 'error');
        void syncFromServer();
      }
    },
    onConnectorAction: async (messageId, connectorId, url) => {
      try {
        const res = await api.chatConnectorAction(projectId, { messageId, connectorId, url });
        setThread(res.chat);
        saveLocalChat(projectId, res.chat);
        if (res.ok === false && res.error) toast(res.error, 'error');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not connect', 'error');
        void syncFromServer();
      }
    },
  };

  async function handleRefresh() {
    if (sending || refreshing) return;
    setRefreshing(true);
    try {
      const res = await api.refreshChat(projectId);
      setThread(res.chat);
      saveLocalChat(projectId, res.chat);
      setText('');
      toast('Chat refreshed', 'success');
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to refresh chat', 'error');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSend(e?: FormEvent) {
    e?.preventDefault();
    await sendMessage(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  function useSuggestion(prompt: string) {
    setText(prompt);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const el = inputRef.current;
      if (el) {
        el.setSelectionRange(prompt.length, prompt.length);
      }
    });
  }

  const fresh = isFreshThread(thread.messages) && !thread.pendingReply;
  const visibleMessages = fresh ? [] : thread.messages;

  return (
    <div className={`chat-shell${fresh ? ' chat-shell-empty' : ''}`}>
      <div className="chat-ambient" aria-hidden="true">
        <span className="chat-ambient-blob chat-ambient-a" />
        <span className="chat-ambient-blob chat-ambient-b" />
        <span className="chat-ambient-blob chat-ambient-c" />
      </div>

      <div className="chat-topbar">
        <div className="chat-topbar-copy">
          <strong>Ask Relix</strong>
          <span>{project.name}</span>
        </div>
        <button
          type="button"
          className="chat-refresh-btn"
          onClick={() => void handleRefresh()}
          disabled={sending || refreshing}
          aria-label="Refresh chat"
          title="Refresh chat"
        >
          <span aria-hidden="true">↻</span>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="chat-messages" ref={listRef}>
        {fresh && (
          <div className="chat-welcome">
            <RelixOrb />
            <h2 className="chat-welcome-title">Welcome, {name}!</h2>
            <p className="chat-welcome-sub">
              I am Relix for {project.name}. Ask me anything about this project.
            </p>
            <div className="chat-suggest-grid">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="chat-suggest-card"
                  onClick={() => useSuggestion(s.prompt)}
                >
                  <span className="chat-suggest-icon" aria-hidden="true">
                    {s.icon}
                  </span>
                  <span className="chat-suggest-copy">
                    <strong>{s.title}</strong>
                    <span>{s.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {visibleMessages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} handlers={blockHandlers} />
        ))}
        {agentNotice && (
          <div className="chat-bubble-row assistant">
            <div className="channel-error">{agentNotice}</div>
          </div>
        )}
        {thread.pendingReply && !agentNotice && (
          <div className="chat-bubble-row assistant">
            <div className="chat-typing">
              <span className="chat-typing-dots">
                <span />
                <span />
                <span />
              </span>
              Relix is working…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chat-composer-wrap" onSubmit={handleSend}>
        <div className="chat-composer-card">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            onKeyDown={onKeyDown}
            placeholder="Ask Relix anything — brand, posts, agents, calendars…"
            rows={2}
            autoFocus
            tabIndex={0}
            readOnly={false}
            aria-label={`Ask Relix for ${project.name}`}
          />
          <div className="chat-composer-bar">
            <div className="chat-composer-chips">
              <span className="chat-chip">{project.name}</span>
              <span className="chat-chip chat-chip-soft">Ask Relix</span>
            </div>
            <div className="chat-composer-actions">
              <button
                type="submit"
                className="chat-send-btn"
                disabled={sending || !text.trim()}
                aria-label={sending ? 'Sending' : 'Send message'}
              >
                {sending ? (
                  <span className="chat-send-spin" />
                ) : (
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 4.5 12 17.5M12 4.5 6.5 10M12 4.5 17.5 10"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fillOpacity="0"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
