import { luhnCheck, detectFinancialData, containsFinancialData } from '../../shared/financial-data-guard';

describe('luhnCheck', () => {
  it('validates a known-good test card number', () => {
    expect(luhnCheck('4111111111111111')).toBe(true);
  });

  it('rejects the same number with one digit flipped', () => {
    expect(luhnCheck('4111111111111112')).toBe(false);
  });

  it('rejects non-digit input', () => {
    expect(luhnCheck('411a111111111111')).toBe(false);
  });
});

describe('detectFinancialData — card numbers', () => {
  it('flags a Luhn-valid card number, spaced', () => {
    const matches = detectFinancialData('here is my card 4111 1111 1111 1111 ok');
    expect(matches.some((m) => m.category === 'card_number')).toBe(true);
  });

  it('flags a Luhn-valid card number, dashed', () => {
    const matches = detectFinancialData('4111-1111-1111-1111');
    expect(matches.some((m) => m.category === 'card_number')).toBe(true);
  });

  it('flags a Luhn-valid card number, unformatted', () => {
    const matches = detectFinancialData('4111111111111111');
    expect(matches.some((m) => m.category === 'card_number')).toBe(true);
  });

  it('does NOT flag a card-shaped but Luhn-invalid number (false-positive resistance)', () => {
    const matches = detectFinancialData('order id 4111111111111112');
    expect(matches.some((m) => m.category === 'card_number')).toBe(false);
  });

  it('does NOT flag a plain phone number', () => {
    expect(containsFinancialData('call me at 415 555 0132')).toBe(false);
  });

  it('does NOT flag ordinary short talk text', () => {
    expect(containsFinancialData('are you selling the used notebook?')).toBe(false);
  });

  it('flags known-good test numbers for Mastercard, Amex, and Discover (not just Visa)', () => {
    expect(detectFinancialData('5500005555555559').some((m) => m.category === 'card_number')).toBe(true);
    expect(detectFinancialData('340000000000009').some((m) => m.category === 'card_number')).toBe(true);
    expect(detectFinancialData('6011000000000004').some((m) => m.category === 'card_number')).toBe(true);
  });

  it('regression: a bare Date.now()-style 13-digit millisecond timestamp is never flagged, even when it happens to be Luhn-valid', () => {
    // Real bug found via e2e failures: length+Luhn alone false-positived on this pattern
    // (used pervasively across the test suite for uniqueness) at roughly a 1-in-10 rate,
    // since Luhn validity is essentially uncorrelated with "is this actually a card number."
    // A timestamp starts with "1" — no card network issues cards starting with 1 — so the
    // network-prefix requirement rules the whole category out regardless of Luhn outcome.
    let luhnValidTimestampFound = false;
    for (let i = 0; i < 500 && !luhnValidTimestampFound; i++) {
      const ts = String(1_786_000_000_000 + Math.floor(Math.random() * 1_000_000_000));
      if (luhnCheck(ts)) {
        luhnValidTimestampFound = true;
        expect(containsFinancialData(`DedicatedIgnoreFlow ${ts}`)).toBe(false);
      }
    }
    expect(luhnValidTimestampFound).toBe(true); // sanity: the loop actually exercised the case
  });

  it('does NOT flag an arbitrary 16-digit Luhn-valid number with no real card network prefix', () => {
    // 1234567890123452 is Luhn-valid but starts with "1" — not Visa/MC/Amex/Discover/etc.
    expect(luhnCheck('1234567890123452')).toBe(true);
    expect(containsFinancialData('order 1234567890123452 shipped')).toBe(false);
  });
});

describe('detectFinancialData — CVV (only alongside a card match)', () => {
  it('flags a 3-4 digit number that appears alongside a valid card number', () => {
    const matches = detectFinancialData('card 4111 1111 1111 1111 cvv 123');
    expect(matches.some((m) => m.category === 'cvv' && m.match === '123')).toBe(true);
  });

  it('does NOT flag a standalone 3-4 digit number with no card number present', () => {
    const matches = detectFinancialData('meet at gate 123');
    expect(matches.some((m) => m.category === 'cvv')).toBe(false);
  });
});

describe('detectFinancialData — IBAN', () => {
  it('flags a well-formed IBAN', () => {
    const matches = detectFinancialData('wire it to GB29NWBK60161331926819 please');
    expect(matches.some((m) => m.category === 'iban' && m.match === 'GB29NWBK60161331926819')).toBe(true);
  });
});

describe('detectFinancialData — US routing/account', () => {
  it('flags a 9-digit routing number adjacent to an account number', () => {
    const matches = detectFinancialData('routing/account 021000021 1234567890');
    expect(matches.some((m) => m.category === 'us_routing_account')).toBe(true);
  });

  it('does NOT flag a lone 9-digit number with nothing adjacent', () => {
    const matches = detectFinancialData('ssn-shaped 021000021 alone here');
    expect(matches.some((m) => m.category === 'us_routing_account')).toBe(false);
  });
});

describe('detectFinancialData — sort code', () => {
  it('flags a UK sort code', () => {
    const matches = detectFinancialData('sort code 20-00-00 for the transfer');
    expect(matches.some((m) => m.category === 'sort_code' && m.match === '20-00-00')).toBe(true);
  });
});

describe('detectFinancialData — crypto wallet', () => {
  it('flags a legacy BTC address', () => {
    const matches = detectFinancialData('send BTC to 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa now');
    expect(matches.some((m) => m.category === 'crypto_wallet')).toBe(true);
  });

  it('flags an ETH address', () => {
    const matches = detectFinancialData('eth wallet 0x00000000000000000000000000000000000000ad here');
    expect(matches.some((m) => m.category === 'crypto_wallet')).toBe(true);
  });
});

describe('containsFinancialData', () => {
  it('is false for empty/whitespace text', () => {
    expect(containsFinancialData('')).toBe(false);
    expect(containsFinancialData('   ')).toBe(false);
  });

  it('is true when any category matches', () => {
    expect(containsFinancialData('4111 1111 1111 1111')).toBe(true);
  });
});
