export type FetchLike = typeof fetch;

export async function readJson(res: Response): Promise<Record<string, unknown>> {
  const data = await res.json().catch(() => ({}));
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function asList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord);
}
