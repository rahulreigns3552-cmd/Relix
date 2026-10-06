import type { ReactNode } from 'react';

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|(?<!\*)\*([^*]+)\*(?!\*)|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const key = `${keyPrefix}-${index++}`;
    if (match[2] || match[3]) nodes.push(<strong key={key}>{match[2] || match[3]}</strong>);
    else if (match[4]) nodes.push(<code key={key}>{match[4]}</code>);
    else if (match[5]) nodes.push(<em key={key}>{match[5]}</em>);
    else if (match[6] && match[7]) {
      nodes.push(<a key={key} href={match[7]} target="_blank" rel="noopener noreferrer">{match[6]}</a>);
    } else if (match[0].startsWith('http')) {
      const href = match[0].replace(/[.,)]$/, '');
      const label = href.replace(/^https?:\/\//, '');
      nodes.push(<a key={key} href={href} target="_blank" rel="noopener noreferrer">{label.length > 42 ? `${label.slice(0, 41)}…` : label}</a>);
    }
    last = start + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function RichText({ text }: { text: string }) {
  const lines = String(text || '').split('\n');
  return (
    <div className="rich-text">
      {lines.map((line, index) => {
        const list = line.match(/^(\s*)(?:[-*]|\d+\.)\s+(.*)$/);
        const body = list ? list[2] : line;
        return (
          <div key={`line-${index}`} className={list ? 'rich-line is-item' : 'rich-line'}>
            {list ? <span className="rich-mark" aria-hidden="true">•</span> : null}
            {body ? inline(body, `l${index}`) : '\u00a0'}
          </div>
        );
      })}
    </div>
  );
}
