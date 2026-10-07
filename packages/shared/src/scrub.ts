const VENDOR_URL = /https?:\/\/(?:[\w.-]+\.)?(?:zernio|ayrshare)\.com[^\s)]*/gi;
const VENDOR_WORD = /\b(?:Zernio|Ayrshare)\b/g;

/** Remove posting-vendor names and the broken lines left when their links are stripped. */
export function scrubVendorText(value: string): string {
  const stripped = String(value ?? '')
    .replace(VENDOR_URL, '')
    .replace(VENDOR_WORD, 'Relix')
    .replace(/\b(?:zernio|ayrshare)\b/gi, 'relix');
  const lines = stripped.split('\n').filter((line) => {
    const compact = line.trim();
    if (!compact) return true;
    if (/^docs:\s*$/i.test(compact)) return false;
    if (/^\d+\.\s*open\s*$/i.test(compact)) return false;
    if (/^or connect in\s*$/i.test(compact)) return false;
    return true;
  });
  return lines
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
