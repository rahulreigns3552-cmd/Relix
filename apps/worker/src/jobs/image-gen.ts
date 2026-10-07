import type { WorkerClient } from '../api.js';

export interface ImageGenDeps {
  client: WorkerClient;
  apiKey: string;
  model: string;
  enabled: boolean;
  apiBase: string;
  log?: (message: string) => void;
  fetchImpl?: typeof fetch;
}

async function referenceFiles(deps: ImageGenDeps, projectId: string): Promise<{ name: string; bytes: Buffer; type: string }[]> {
  const listed = await deps.client.getBrandReferences(projectId);
  const fetchImpl = deps.fetchImpl || fetch;
  const files = [];
  for (const file of listed.files || []) {
    if (!file.url) continue;
    const response = await fetchImpl(`${deps.apiBase}${file.url}`);
    if (!response.ok) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) continue;
    const type = file.name.toLowerCase().endsWith('.png') ? 'image/png'
      : file.name.toLowerCase().endsWith('.webp') ? 'image/webp'
        : 'image/jpeg';
    files.push({ name: file.name, bytes, type });
  }
  return files;
}

export async function runImageGen(deps: ImageGenDeps): Promise<{ generated: number; skipped: number }> {
  if (!deps.enabled) {
    deps.log?.('image generation skipped; WORKER_IMAGEGEN_ENABLED is false');
    return { generated: 0, skipped: 0 };
  }
  if (!deps.apiKey) {
    deps.log?.('image generation skipped; OPENAI_API_KEY is missing');
    return { generated: 0, skipped: 0 };
  }
  const fetchImpl = deps.fetchImpl || fetch;
  const { items } = await deps.client.getImageWork();
  let generated = 0;
  let skipped = 0;
  const cache = new Map<string, { name: string; bytes: Buffer; type: string }[]>();
  for (const item of items || []) {
    if (!item.projectId || !item.id) {
      skipped += 1;
      continue;
    }
    if (!cache.has(item.projectId)) cache.set(item.projectId, await referenceFiles(deps, item.projectId));
    const refs = cache.get(item.projectId) || [];
    if (!refs.length) {
      deps.log?.(`image generation skipped for ${item.projectId}; no brand reference images`);
      skipped += 1;
      continue;
    }
    const prompt = [
      'Create a square social image for this brand.',
      'Use the attached reference images for the logo and the product box. Keep those shapes and colours.',
      `Caption: ${String(item.caption || '').slice(0, 500)}`,
      item.feedback ? `Change requested: ${String(item.feedback).slice(0, 300)}` : '',
      'Do not add a posting-provider name. Do not add approval stamps.',
    ].filter(Boolean).join('\n');
    try {
      const form = new FormData();
      form.set('model', deps.model || 'gpt-image-1');
      form.set('prompt', prompt);
      form.set('size', '1024x1024');
      for (const file of refs) {
        const copy = new Uint8Array(file.bytes.byteLength);
        copy.set(file.bytes);
        form.append('image', new Blob([copy], { type: file.type }), file.name);
      }
      const response = await fetchImpl('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${deps.apiKey}` },
        body: form,
      });
      const data = await response.json().catch(() => ({})) as { data?: { b64_json?: string }[] };
      const b64 = String(data.data?.[0]?.b64_json || '');
      if (!response.ok || !b64) {
        skipped += 1;
        continue;
      }
      const saved = await deps.client.saveGeneratedImage(item.projectId, item.id, b64);
      if (item.kind === 'revise') {
        await deps.client.updateIgItem(item.projectId, item.id, {
          imageUrl: saved.item?.imageUrl || '',
          caption: item.caption || '',
          hashtags: item.hashtags || [],
        });
      }
      generated += 1;
    } catch (error) {
      skipped += 1;
      deps.log?.(`image generation failed: ${error instanceof Error ? error.message : 'error'}`);
    }
  }
  return { generated, skipped };
}
