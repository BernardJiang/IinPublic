/**
 * Return the peers that `localUserId` should connect to during one bounded rotation window.
 *
 * The circle-method tournament schedule has two properties the direct Talk transport needs:
 * every pair is eventually scheduled, and both endpoints independently choose each other for
 * the same window. Taking `K` consecutive tournament rounds gives each device at most `K`
 * simultaneous direct links and covers a room of N users in ceil((N - 1) / K) windows.
 */
export function selectDirectTalkPeers(
  memberUserIds: string[],
  localUserId: string,
  maxPeers: number,
  windowIndex: number,
): string[] {
  const ids = [...new Set(memberUserIds.map((id) => String(id || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  if (!ids.includes(localUserId)) ids.push(localUserId);
  ids.sort((left, right) => left.localeCompare(right));
  if (ids.length <= 1 || maxPeers <= 0) return [];

  const bye = '__iinpublic_direct_talk_bye__';
  if (ids.length % 2 === 1) ids.push(bye);
  const rounds = ids.length - 1;
  const limit = Math.max(1, Math.min(Math.floor(maxPeers), rounds));
  const normalizedWindow = Number.isFinite(windowIndex)
    ? Math.max(0, Math.floor(windowIndex))
    : 0;
  const selected = new Set<string>();

  for (let offset = 0; offset < limit; offset += 1) {
    const round = (normalizedWindow * limit + offset) % rounds;
    const rotated = rotateTournament(ids, round);
    for (let left = 0; left < rotated.length / 2; left += 1) {
      const right = rotated.length - 1 - left;
      const a = rotated[left];
      const b = rotated[right];
      if (a === localUserId && b !== bye) selected.add(b);
      if (b === localUserId && a !== bye) selected.add(a);
    }
  }
  return [...selected];
}

function rotateTournament(ids: string[], round: number): string[] {
  if (round === 0) return [...ids];
  const fixed = ids[0];
  const rotating = ids.slice(1);
  const shift = round % rotating.length;
  return [fixed, ...rotating.slice(-shift), ...rotating.slice(0, -shift)];
}

