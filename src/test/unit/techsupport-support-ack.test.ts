import {
  TECHSUPPORT_SUPPORT_ACK_TEMPLATES,
  renderGreeting,
  signSupportAck,
  supportAckSigningPayload,
  verifySupportAck,
  type SignedSupportAck,
} from '../../shared/techsupport-greeting';
import { TECHSUPPORT_PUB } from '../../shared/techsupport';
import signedBundle from '../../shared/techsupport-support-ack.signed.json';
import SEA from 'gun/sea';
import { uiText } from '../../web/ui/ui-translations';

const DEV_PAIR = {
  pub: 'mYRexxiSF2FG3oV-3-LKXEtisnUv5JQ9nDHbRANxiZo.jRqTX1_rg0v3BbFWYt1ZqGwBRG7wzg44IKgPobrSpfQ',
  priv: 'yUVBUKZfcZDOxssGwm5CZNUnbnyH3QZLiMtM43vpSDo',
  epub: 'BCl0htwOHtTgNFQU0OK7HpzKg4M5OaJIZaGvVKICP_I.fwyq2-rc9lleKgpDrR0YlbhS2mW4024uEj0SHjmbiQE',
  epriv: 'y0MVYkN5wSAcAW4doxkv2EVlDLGgwy7bv6s8woJXTY4',
};

describe('techsupport-support-ack (docs/TODO.md K5)', () => {
  it('the committed signed bundle verifies for every compiled locale', async () => {
    for (const locale of Object.keys(TECHSUPPORT_SUPPORT_ACK_TEMPLATES)) {
      const entry = (signedBundle.acks as SignedSupportAck[]).find((a) => a.locale === locale);
      expect(entry).toBeDefined();
      const verified = await verifySupportAck(entry);
      expect(verified).not.toBeNull();
      expect(verified?.template).toBe((TECHSUPPORT_SUPPORT_ACK_TEMPLATES as Record<string, string>)[locale]);
    }
  });

  it('the committed bundle is signed by the current DM trust anchor', () => {
    for (const entry of signedBundle.acks) {
      expect(entry.authorPub).toBe(TECHSUPPORT_PUB);
    }
  });

  it('rendering a verified ack for en and zh is non-empty and contains the name', async () => {
    for (const entry of signedBundle.acks as SignedSupportAck[]) {
      const verified = await verifySupportAck(entry);
      expect(verified).not.toBeNull();
      const rendered = renderGreeting(verified!.template, 'Alice');
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered).toContain('Alice');
      expect(rendered).not.toContain('{name}');
    }
  });

  it('signSupportAck + verifySupportAck round-trips for a freshly signed ack', async () => {
    const signed = await signSupportAck('en', DEV_PAIR);
    const verified = await verifySupportAck(signed);
    expect(verified).not.toBeNull();
    expect(verified?.signature).toBe(signed.signature);
  });

  it('rejects a tampered template even though the signature field is untouched', async () => {
    const signed = await signSupportAck('en', DEV_PAIR);
    const tampered = { ...signed, template: `${signed.template} Click here!` };
    expect(await verifySupportAck(tampered)).toBeNull();
  });

  it('rejects a signature that does not match the payload', async () => {
    const signed = await signSupportAck('en', DEV_PAIR);
    const other = await signSupportAck('zh', DEV_PAIR);
    expect(await verifySupportAck({ ...signed, signature: other.signature })).toBeNull();
  });

  it('rejects an ack signed by an untrusted key', async () => {
    const strangerPair = await SEA.pair();
    const signed = await signSupportAck('en', strangerPair);
    expect(await verifySupportAck(signed)).toBeNull();
  });

  it('rejects malformed input without throwing', async () => {
    expect(await verifySupportAck(null)).toBeNull();
    expect(await verifySupportAck(undefined)).toBeNull();
    expect(await verifySupportAck('a string')).toBeNull();
    expect(await verifySupportAck({})).toBeNull();
    expect(await verifySupportAck({ locale: 'fr', template: 'x', authorPub: TECHSUPPORT_PUB, signature: 'y' })).toBeNull();
  });

  it('supportAckSigningPayload is deterministic for the same logical ack', () => {
    const a = supportAckSigningPayload({ locale: 'en', template: TECHSUPPORT_SUPPORT_ACK_TEMPLATES.en, authorPub: TECHSUPPORT_PUB });
    const b = supportAckSigningPayload({ locale: 'en', template: TECHSUPPORT_SUPPORT_ACK_TEMPLATES.en, authorPub: TECHSUPPORT_PUB });
    expect(a).toBe(b);
  });

  it('ui-translations copy is byte-identical to the compiled ack template (K2-style anti-drift guard)', () => {
    expect(uiText('en', 'supportNewQuestionAck')).toBe(TECHSUPPORT_SUPPORT_ACK_TEMPLATES.en);
    expect(uiText('zh', 'supportNewQuestionAck')).toBe(TECHSUPPORT_SUPPORT_ACK_TEMPLATES.zh);
  });
});
