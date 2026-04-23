/**
 * Pure formatting helpers shared across UI modules.
 * No DOM or state dependencies — safe to unit-test in Node.
 */

export function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function formatExpiration(expiresAt: number | null | undefined): string {
  if (expiresAt == null) return 'Forever';
  const now = Date.now();
  if (now > expiresAt) return 'Expired';
  const oneDay = 24 * 60 * 60 * 1000;
  const left = expiresAt - now;
  if (left <= oneDay) return 'Expires in &lt;1d';
  if (left <= 7 * oneDay) return `Expires in ${Math.floor(left / oneDay)}d`;
  if (left <= 30 * oneDay) return `Expires in ${Math.floor(left / (7 * oneDay))}w`;
  if (left <= 365 * oneDay) return `Expires in ${Math.floor(left / (30 * oneDay))}mo`;
  return `Expires in ${Math.floor(left / (365 * oneDay))}y`;
}

export function formatLocationRadius(radiusMiles: number | null | undefined): string {
  if (radiusMiles == null) return 'Anywhere';
  return `${radiusMiles} mi`;
}

/**
 * Escape a string for safe insertion into HTML.
 * Covers the five characters that must be escaped in HTML text and quoted attributes.
 */
export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
