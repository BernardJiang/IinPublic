/**
 * Financial/payment data detection (spec §7.4, FR-FIN-3).
 *
 * Pure, dependency-free pattern matching — no AI, no fuzzy matching, mirroring the
 * determinism invariant the rest of the filtering/matching system already holds to
 * (FR-QA-7). Used by `message-content-filter.ts` to mandatorily block payment data
 * from ever reaching Gun or a peer (FR-FIN-2/FR-FIN-4).
 *
 * Card numbers are only flagged when they match a real card network's IIN prefix,
 * are the right length for that network, AND are Luhn-valid — length+Luhn alone is
 * NOT sufficient (found the hard way: a bare 13-digit `Date.now()` timestamp, used
 * pervasively across this codebase's own test suite for uniqueness, passes Luhn purely
 * by chance ~10% of the time — length+Luhn alone false-positived on ordinary
 * non-payment numbers with no plausible card shape at all, e.g. a millisecond epoch
 * starting with "1"). Real card-detection tools always validate the network prefix for
 * exactly this reason; length+Luhn alone is a well-known over-broad heuristic.
 */

export type FinancialDataCategory =
  | 'card_number'
  | 'cvv'
  | 'iban'
  | 'us_routing_account'
  | 'sort_code'
  | 'crypto_wallet';

export interface FinancialDataMatch {
  category: FinancialDataCategory;
  match: string;
}

/** Luhn checksum over a digit-only string. Returns false for non-digit input. */
export function luhnCheck(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alternate) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

const CARD_CANDIDATE_RE = /\b(?:\d[ -]?){12,18}\d\b/g;
/**
 * Card network IIN (Issuer Identification Number) prefixes, applied to the digits-only
 * candidate before the Luhn check. Anchored (`^...$`) — the whole candidate must be one
 * network's shape, not merely contain a prefix substring somewhere.
 *   Visa: 4, length 13/16/19 · Mastercard: 51-55 or 2221-2720, length 16
 *   Amex: 34/37, length 15 · Discover: 6011/65xx, length 16
 *   Diners Club: 300-305/36/38, length 14 · JCB: 2131/1800/35xxx, length 15/16
 */
const CARD_NETWORK_RE =
  /^(?:4\d{12}(?:\d{3})?(?:\d{3})?|5[1-5]\d{14}|2(?:2[2-9]\d|[3-6]\d{2}|7[01]\d|720)\d{12}|3[47]\d{13}|6(?:011|5\d{2})\d{12}|3(?:0[0-5]|[68]\d)\d{11}|(?:2131|1800|35\d{3})\d{10,11})$/;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7,}[A-Z0-9]{0,16}\b/g;
const US_ROUTING_ACCOUNT_RE = /\b(\d{9})\b[ ,]{1,3}\b(\d{5,17})\b/g;
const SORT_CODE_RE = /\b\d{2}-\d{2}-\d{2}\b/g;
// Legacy/P2SH BTC addresses, bech32 BTC addresses, and EOA-shaped ETH addresses.
const CRYPTO_WALLET_RE = /\b(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{25,90}|0x[a-fA-F0-9]{40})\b/g;
const STANDALONE_3_4_DIGIT_RE = /\b\d{3,4}\b/g;

function findCardNumbers(text: string): FinancialDataMatch[] {
  const matches: FinancialDataMatch[] = [];
  for (const m of text.matchAll(CARD_CANDIDATE_RE)) {
    const digitsOnly = m[0].replace(/[ -]/g, '');
    if (CARD_NETWORK_RE.test(digitsOnly) && luhnCheck(digitsOnly)) {
      matches.push({ category: 'card_number', match: m[0] });
    }
  }
  return matches;
}

/** CVV is only meaningful — and only flagged — alongside an actual card-number match. */
function findCvvNearCardMatches(text: string, cardMatches: FinancialDataMatch[]): FinancialDataMatch[] {
  if (cardMatches.length === 0) return [];
  const cardSpans = new Set(cardMatches.map((m) => m.match));
  const matches: FinancialDataMatch[] = [];
  for (const m of text.matchAll(STANDALONE_3_4_DIGIT_RE)) {
    if (cardSpans.has(m[0])) continue;
    matches.push({ category: 'cvv', match: m[0] });
  }
  return matches;
}

function findByPattern(text: string, re: RegExp, category: FinancialDataCategory): FinancialDataMatch[] {
  const matches: FinancialDataMatch[] = [];
  for (const m of text.matchAll(re)) {
    matches.push({ category, match: m[0] });
  }
  return matches;
}

/** Detect every financial-data category present in free text. Never throws, never mutates input. */
export function detectFinancialData(text: string): FinancialDataMatch[] {
  const content = String(text ?? '');
  if (!content.trim()) return [];

  const cardMatches = findCardNumbers(content);
  return [
    ...cardMatches,
    ...findCvvNearCardMatches(content, cardMatches),
    ...findByPattern(content, IBAN_RE, 'iban'),
    ...findByPattern(content, US_ROUTING_ACCOUNT_RE, 'us_routing_account'),
    ...findByPattern(content, SORT_CODE_RE, 'sort_code'),
    ...findByPattern(content, CRYPTO_WALLET_RE, 'crypto_wallet'),
  ];
}

export function containsFinancialData(text: string): boolean {
  return detectFinancialData(text).length > 0;
}
