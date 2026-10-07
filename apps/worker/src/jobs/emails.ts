import { scrubVendorText } from '@relix/shared';
import type { SmtpConfig, OutboundMail } from '../mail.js';
import type { WorkerClient } from '../api.js';

export async function runEmails(deps: {
  client: WorkerClient;
  smtp: SmtpConfig | null;
  send: (message: OutboundMail) => Promise<void>;
  log?: (message: string) => void;
}): Promise<{ leads: number; approvals: number; skipped: number }> {
  if (!deps.smtp) {
    deps.log?.('email skipped; SMTP_HOST, SMTP_USER, SMTP_PASS, or SMTP_FROM is missing');
    return { leads: 0, approvals: 0, skipped: 0 };
  }
  let leads = 0;
  let approvals = 0;
  let skipped = 0;
  const pending = await deps.client.getPendingLeads();
  for (const lead of pending.leads || []) {
    const to = String(lead.to || '').trim();
    if (!lead.id || !to) {
      skipped += 1;
      continue;
    }
    const lines = (lead.transcript || []).map((turn) => `${turn.role === 'user' ? 'User' : 'Relix'}: ${turn.text}`);
    try {
      await deps.send({
        to,
        subject: `Relix chat · ${lead.projectId || 'brand'}`,
        text: scrubVendorText(lines.join('\n\n') || 'A chat was completed.'),
      });
      await deps.client.markLeadSent(lead.id);
      leads += 1;
    } catch (error) {
      skipped += 1;
      deps.log?.(`lead email failed: ${error instanceof Error ? error.message : 'error'}`);
    }
  }
  const waiting = await deps.client.getAwaitingEmail();
  for (const item of waiting.items || []) {
    if (!item.id || !item.to || !item.approveUrl || !item.projectId) {
      skipped += 1;
      continue;
    }
    const text = scrubVendorText([
      'A post is waiting for your approval.',
      '',
      item.caption || '(no caption)',
      '',
      `Approve: ${item.approveUrl}`,
      '',
      'Nothing goes live until you approve. Opening the link only marks the preview approved.',
    ].join('\n'));
    try {
      await deps.send({ to: item.to, subject: 'Relix · approve this post', text });
      await deps.client.markApprovalEmailSent(item.projectId, item.id, item.to);
      approvals += 1;
    } catch (error) {
      skipped += 1;
      deps.log?.(`approval email failed: ${error instanceof Error ? error.message : 'error'}`);
    }
  }
  return { leads, approvals, skipped };
}
