import { parseServerBlockedTermList } from '../shared/server-content-moderation';

let memo: string[] | null = null;

/** Terms from `IINPUBLIC_SERVER_BLOCKED_TERMS` (cached). Sender-side + delivery-time enforcement. */
export function getServerBlockedTerms(): string[] {
  if (!memo) {
    memo = parseServerBlockedTermList(process.env.IINPUBLIC_SERVER_BLOCKED_TERMS);
  }
  return memo;
}

/** Integration tests: env may change between cases. */
export function __resetServerBlockedTermsCacheForTests(): void {
  memo = null;
}
