const handoffs = new Map<string, { url: string; exp: number }>();

export function rememberHandoff(state: string, url: string, ttlMs = 15 * 60 * 1000): void {
  handoffs.set(state, { url, exp: Date.now() + ttlMs });
}

export function peekHandoff(state: string): string | null {
  const row = handoffs.get(state);
  if (!row) return null;
  if (row.exp < Date.now()) {
    handoffs.delete(state);
    return null;
  }
  return row.url;
}
