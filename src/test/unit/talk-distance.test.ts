import { formatTalkDistanceFromAuthor } from '../../web/ui/talk-distance';
import type { GPSCoordinate } from '../../shared/types';

function coord(latitude: number, longitude: number): GPSCoordinate {
  return { latitude, longitude, accuracy: 10, timestamp: new Date() };
}

describe('formatTalkDistanceFromAuthor', () => {
  it('returns empty when there is no current location', () => {
    expect(formatTalkDistanceFromAuthor({ latitude: 1, longitude: 1 }, undefined)).toBe('');
  });

  it('returns empty when there is no author location', () => {
    expect(formatTalkDistanceFromAuthor(null, coord(0, 0))).toBe('');
  });

  it('returns empty when the author location has non-numeric coordinates', () => {
    expect(formatTalkDistanceFromAuthor({ latitude: NaN, longitude: 1 }, coord(0, 0))).toBe('');
  });

  it('formats a very close distance as "<0.1 mi"', () => {
    const here = coord(37.7749, -122.4194);
    const veryClose = { latitude: 37.77491, longitude: -122.4194 };
    expect(formatTalkDistanceFromAuthor(veryClose, here)).toBe('<0.1 mi');
  });

  it('formats a sub-10-mile distance with one decimal place', () => {
    const here = coord(37.7749, -122.4194);
    // ~3.4 miles north
    const near = { latitude: 37.8249, longitude: -122.4194 };
    const result = formatTalkDistanceFromAuthor(near, here);
    expect(result).toMatch(/^~\d+\.\d mi$/);
  });

  it('formats a 10+ mile distance rounded to the nearest mile', () => {
    const here = coord(37.7749, -122.4194);
    // ~69 miles south (roughly San Jose to Monterey range)
    const far = { latitude: 36.6, longitude: -121.9 };
    const result = formatTalkDistanceFromAuthor(far, here);
    expect(result).toMatch(/^~\d+ mi$/);
  });
});
