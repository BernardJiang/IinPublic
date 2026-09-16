import {
  TECHSUPPORT_GREETING_TEMPLATES,
  greetingSigningPayload,
  renderGreeting,
  signGreeting,
  verifyTechSupportGreeting,
  type SignedGreeting,
} from '../../shared/techsupport-greeting';
import { TECHSUPPORT_PUB } from '../../shared/techsupport';
import signedBundle from '../../shared/techsupport-greeting.signed.json';
import SEA from 'gun/sea';
import { describeWithRealTechSupportPair } from '../support/techsupport-real-pair';

describeWithRealTechSupportPair('techsupport-greeting (docs/TODO.md K2)', (DEV_PAIR) => {
  it('the committed signed bundle verifies for every compiled locale', async () => {
    for (const locale of Object.keys(TECHSUPPORT_GREETING_TEMPLATES)) {
      const entry = (signedBundle.greetings as SignedGreeting[]).find((g) => g.locale === locale);
      expect(entry).toBeDefined();
      const verified = await verifyTechSupportGreeting(entry);
      expect(verified).not.toBeNull();
      expect(verified?.template).toBe((TECHSUPPORT_GREETING_TEMPLATES as Record<string, string>)[locale]);
    }
  });

  it('the committed bundle is signed by the current DM trust anchor', () => {
    for (const entry of signedBundle.greetings) {
      expect(entry.authorPub).toBe(TECHSUPPORT_PUB);
    }
  });

  it('rendering a verified greeting for en and zh is non-empty and contains the name', async () => {
    for (const entry of signedBundle.greetings as SignedGreeting[]) {
      const verified = await verifyTechSupportGreeting(entry);
      expect(verified).not.toBeNull();
      const rendered = renderGreeting(verified!.template, 'Alice');
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered).toContain('Alice');
      expect(rendered).not.toContain('{name}');
    }
  });

  it('signGreeting + verifyTechSupportGreeting round-trips for a freshly signed greeting', async () => {
    const signed = await signGreeting('en', DEV_PAIR);
    const verified = await verifyTechSupportGreeting(signed);
    expect(verified).not.toBeNull();
    expect(verified?.signature).toBe(signed.signature);
  });

  it('rejects a tampered template even though the signature field is untouched', async () => {
    const signed = await signGreeting('en', DEV_PAIR);
    const tampered = { ...signed, template: `${signed.template} — click here for a free prize` };
    expect(await verifyTechSupportGreeting(tampered)).toBeNull();
  });

  it('rejects a signature that does not match the payload', async () => {
    const signed = await signGreeting('en', DEV_PAIR);
    const otherSigned = await signGreeting('zh', DEV_PAIR);
    const mismatched = { ...signed, signature: otherSigned.signature };
    expect(await verifyTechSupportGreeting(mismatched)).toBeNull();
  });

  it('rejects a greeting signed by an untrusted key', async () => {
    const strangerPair = await SEA.pair();
    const signed = await signGreeting('en', strangerPair as typeof DEV_PAIR);
    expect(await verifyTechSupportGreeting(signed)).toBeNull();
  });

  it('rejects an unknown locale', async () => {
    const signed = await signGreeting('en', DEV_PAIR);
    expect(await verifyTechSupportGreeting({ ...signed, locale: 'fr' })).toBeNull();
  });

  it('rejects malformed/missing input without throwing', async () => {
    expect(await verifyTechSupportGreeting(null)).toBeNull();
    expect(await verifyTechSupportGreeting(undefined)).toBeNull();
    expect(await verifyTechSupportGreeting('a string')).toBeNull();
    expect(await verifyTechSupportGreeting({})).toBeNull();
  });

  it('greetingSigningPayload is deterministic regardless of key insertion order', () => {
    const a = greetingSigningPayload({ locale: 'en', template: 'x', authorPub: 'p' });
    const b = greetingSigningPayload({ authorPub: 'p', template: 'x', locale: 'en' });
    expect(a).toBe(b);
  });

  it('renderGreeting only replaces the first {name} placeholder occurrence', () => {
    expect(renderGreeting('Hi {name}, welcome {name}!', 'Bo')).toBe('Hi Bo, welcome {name}!');
  });
});
