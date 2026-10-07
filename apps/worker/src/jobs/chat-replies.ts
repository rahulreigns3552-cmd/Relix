import { RELIX_AGENT_SYSTEM_PROMPT, scrubVendorText } from '@relix/shared';
import type { WorkerClient } from '../api.js';

export interface ChatDeps {
  client: WorkerClient;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

export async function runChatReplies(deps: ChatDeps): Promise<{ replied: number; skipped: number }> {
  if (!deps.apiKey) {
    deps.log?.('chat replies skipped; OPENAI_API_KEY is missing');
    return { replied: 0, skipped: 0 };
  }
  const fetchImpl = deps.fetchImpl || fetch;
  const { jobs } = await deps.client.getPendingChat();
  let replied = 0;
  let skipped = 0;
  for (const job of jobs || []) {
    const text = String(job.text || '').trim();
    if (!job.id || !job.projectId || !text) {
      skipped += 1;
      continue;
    }
    const completion = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${deps.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: deps.model || 'gpt-4o-mini',
        temperature: 0.4,
        messages: [
          { role: 'system', content: RELIX_AGENT_SYSTEM_PROMPT },
          { role: 'user', content: text.slice(0, 4000) },
        ],
      }),
    });
    const data = await completion.json().catch(() => ({})) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = String(data.choices?.[0]?.message?.content || '').trim();
    if (!completion.ok || !raw) {
      skipped += 1;
      continue;
    }
    const reply = scrubVendorText(raw)
      .replace(/\b(i|we)\s+(just\s+)?(published|emailed|sent an email)\b/gi, 'I queued that for review')
      .replace(/\bemail sent\b/gi, 'queued for review');
    await deps.client.replyChat(job.projectId, job.id, reply);
    replied += 1;
  }
  return { replied, skipped };
}
