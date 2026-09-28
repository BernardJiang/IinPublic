import { compareVersions, isNewerVersion } from '../../shared/semver-compare';

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.0.57', '1.0.57')).toBe(0);
  });

  it('compares patch versions', () => {
    expect(compareVersions('1.0.58', '1.0.57')).toBe(1);
    expect(compareVersions('1.0.57', '1.0.58')).toBe(-1);
  });

  it('compares minor versions ahead of patch', () => {
    expect(compareVersions('1.1.0', '1.0.99')).toBe(1);
    expect(compareVersions('1.0.99', '1.1.0')).toBe(-1);
  });

  it('compares major versions ahead of everything else', () => {
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
  });

  it('treats a shorter version as having trailing zero segments', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.1')).toBe(-1);
    expect(compareVersions('1.2.1', '1.2')).toBe(1);
  });

  it('treats malformed/non-numeric segments as 0 rather than throwing', () => {
    expect(compareVersions('1.x.0', '1.0.0')).toBe(0);
    expect(() => compareVersions('not-a-version', '1.0.0')).not.toThrow();
    expect(compareVersions('', '1.0.0')).toBe(-1);
  });

  it('tolerates null/undefined input without throwing', () => {
    expect(() => compareVersions(null as unknown as string, '1.0.0')).not.toThrow();
    expect(compareVersions(undefined as unknown as string, undefined as unknown as string)).toBe(0);
  });
});

describe('isNewerVersion', () => {
  it('is true only when the candidate is strictly newer', () => {
    expect(isNewerVersion('1.0.58', '1.0.57')).toBe(true);
    expect(isNewerVersion('1.0.57', '1.0.57')).toBe(false);
    expect(isNewerVersion('1.0.56', '1.0.57')).toBe(false);
  });
});
