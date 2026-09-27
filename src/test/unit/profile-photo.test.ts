import {
  PROFILE_PHOTO_EDGE_PX,
  PROFILE_PHOTO_MAX_BYTES,
  coverCropRect,
  dataUrlByteLength,
  encodeWithinBudget,
} from '../../web/ui/profile-photo';

/** A data URL whose decoded image is exactly `bytes` long. */
function fakeDataUrl(bytes: number): string {
  return `data:image/jpeg;base64,${Buffer.alloc(bytes, 1).toString('base64')}`;
}

describe('profile photo shrinking', () => {
  describe('coverCropRect', () => {
    it('centre-crops a landscape photo to its height', () => {
      expect(coverCropRect(4000, 3000)).toEqual({ sx: 500, sy: 0, size: 3000 });
    });
    it('centre-crops a portrait photo to its width', () => {
      expect(coverCropRect(3000, 4000)).toEqual({ sx: 0, sy: 500, size: 3000 });
    });
    it('leaves a square photo whole and never returns a zero/negative size', () => {
      expect(coverCropRect(800, 800)).toEqual({ sx: 0, sy: 0, size: 800 });
      expect(coverCropRect(0, 0).size).toBe(1);
    });
  });

  describe('dataUrlByteLength', () => {
    it('measures the decoded image, accounting for base64 padding', () => {
      for (const n of [0, 1, 2, 3, 4, 1000, PROFILE_PHOTO_MAX_BYTES]) expect(dataUrlByteLength(fakeDataUrl(n))).toBe(n);
    });
    it('is 0 for something that is not a data URL', () => {
      expect(dataUrlByteLength('not a data url')).toBe(0);
    });
  });

  describe('encodeWithinBudget', () => {
    it('keeps the best quality at full size when it already fits (a small photo is not degraded)', () => {
      const encode = jest.fn((_edge: number, _quality: number) => fakeDataUrl(20 * 1024));
      const out = encodeWithinBudget(encode);
      expect(encode).toHaveBeenCalledTimes(1);
      expect(encode).toHaveBeenCalledWith(PROFILE_PHOTO_EDGE_PX, expect.any(Number));
      expect(dataUrlByteLength(out)).toBe(20 * 1024);
    });

    it('lowers quality first, then size, until the result fits — however big the original was', () => {
      // A 12 MB-original stand-in: size in bytes grows with quality and with edge^2.
      const encode = jest.fn((edge: number, quality: number) => fakeDataUrl(Math.round(edge * edge * quality * 0.9)));
      const out = encodeWithinBudget(encode);
      expect(dataUrlByteLength(out)).toBeLessThanOrEqual(PROFILE_PHOTO_MAX_BYTES);
      // At full size the budget needs a low quality here, so it stepped down rather than stopping at the first try.
      expect(encode.mock.calls.length).toBeGreaterThan(1);
      const qualitiesAtFullSize = encode.mock.calls.filter(([edge]) => edge === PROFILE_PHOTO_EDGE_PX).map(([, q]) => q);
      expect(qualitiesAtFullSize).toEqual([...qualitiesAtFullSize].sort((a, b) => b - a));
    });

    it('drops to a smaller edge when no quality at the larger edge fits', () => {
      const edgesTried = new Set<number>();
      const encode = (edge: number, _quality: number) => {
        edgesTried.add(edge);
        return fakeDataUrl(edge >= 320 ? 400 * 1024 : 20 * 1024); // only < 320 px fits
      };
      const out = encodeWithinBudget(encode);
      expect(dataUrlByteLength(out)).toBe(20 * 1024);
      expect(edgesTried.has(320)).toBe(true);
      expect(edgesTried.has(256)).toBe(true);
    });

    it('the stored photo is small enough to live inside the public Gun profile record', () => {
      expect(PROFILE_PHOTO_MAX_BYTES).toBeLessThanOrEqual(64 * 1024);
      expect(PROFILE_PHOTO_EDGE_PX).toBeLessThanOrEqual(320);
    });

    it('returns the smallest attempt instead of failing when nothing fits the budget', () => {
      const out = encodeWithinBudget((edge) => fakeDataUrl(edge * 10_000), PROFILE_PHOTO_MAX_BYTES, [512, 256], [0.9, 0.5]);
      expect(dataUrlByteLength(out)).toBe(256 * 10_000);
    });
  });
});
