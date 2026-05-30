import {
  decodeSignalingPayload,
  encodeSignalingPayload,
} from '../../web/services/p2p-signaling-client';

describe('p2p-signaling-client', () => {
  it('round-trips signaling payloads with SEA prefix', () => {
    const payload = { type: 'offer', sdp: { type: 'offer', sdp: 'v=0' } };
    const encoded = encodeSignalingPayload(payload);
    expect(encoded.startsWith('SEA{')).toBe(true);
    expect(decodeSignalingPayload(encoded)).toEqual(payload);
  });

  it('rejects ciphertext without SEA prefix', () => {
    expect(() => decodeSignalingPayload('{"type":"offer"}')).toThrow(/Invalid signaling/);
  });
});
