import {
  PUBLIC_LOCATION_MIN_METERS,
  isPublicLocation,
  parsePublicLocationRegion,
  publicLocationFor,
  publicLocationPrecisionMeters,
  publicLocationRegion,
  publicLocationWithHysteresis,
  snapPublicLocation,
} from '../../shared/public-location';

const SD = { latitude: 32.715738, longitude: -117.161084 };
const metersBetween = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) =>
  Math.hypot((a.latitude - b.latitude) * 111_320, (a.longitude - b.longitude) * 111_320 * Math.cos((a.latitude * Math.PI) / 180));

describe('public location', () => {
  it('publishes at least 1 km, follows coarser settings, and publishes nothing for private ones', () => {
    expect(publicLocationPrecisionMeters('close-nearby')).toBe(PUBLIC_LOCATION_MIN_METERS);
    expect(publicLocationPrecisionMeters('neighborhood')).toBe(1_000);
    expect(publicLocationPrecisionMeters('citywide')).toBe(10_000);
    expect(publicLocationPrecisionMeters('regional')).toBe(50_000);
    expect(publicLocationPrecisionMeters('contacts-only')).toBeNull();
    expect(publicLocationPrecisionMeters('location-off')).toBeNull();
    // A vague fix moves up a grid, never down.
    expect(publicLocationPrecisionMeters('neighborhood', 900)).toBe(10_000);
    expect(publicLocationFor({ ...SD, accuracy: 10 }, 'location-off')).toBeNull();
  });

  it('gives everyone in one square exactly the same point, never the exact fix', () => {
    const snapped = snapPublicLocation(SD, 1_000);
    const nearby = snapPublicLocation({ latitude: snapped.latitude + 0.003, longitude: snapped.longitude - 0.003 }, 1_000);
    expect(nearby).toEqual(snapped);
    expect(snapped).not.toEqual(expect.objectContaining(SD));
    expect(metersBetween(snapped, SD)).toBeLessThanOrEqual(Math.SQRT2 * 500 + 1);
    expect(metersBetween(snapPublicLocation(SD, 50_000), SD)).toBeLessThanOrEqual(Math.SQRT2 * 25_000 + 1);
  });

  it('accepts only grid centres, so a receiver can reject a raw coordinate', () => {
    const snapped = snapPublicLocation(SD, 1_000);
    expect(isPublicLocation(snapped)).toBe(true);
    expect(snapPublicLocation(snapped, 1_000)).toEqual(snapped);
    expect(isPublicLocation({ ...SD, precisionMeters: 1_000 })).toBe(false);
    expect(isPublicLocation({ ...snapped, precisionMeters: 400 })).toBe(false);
  });

  it('round-trips through the users/<id>/location region form', () => {
    const snapped = snapPublicLocation(SD, 10_000);
    expect(parsePublicLocationRegion(publicLocationRegion(snapped))).toEqual(snapped);
    expect(parsePublicLocationRegion(`cell_${SD.latitude}_${SD.longitude}_1000`)).toBeNull();
  });

  it('keeps the old square until the device is 15% of a square past its edge', () => {
    const previous = snapPublicLocation(SD, 1_000);
    const halfLatitude = 1_000 / 111_320 / 2;
    const justOver = { latitude: previous.latitude + halfLatitude * 1.2, longitude: previous.longitude };
    const wellOver = { latitude: previous.latitude + halfLatitude * 1.5, longitude: previous.longitude };
    expect(snapPublicLocation(justOver, 1_000)).not.toEqual(previous);
    expect(publicLocationWithHysteresis(justOver, 'neighborhood', previous)).toEqual(previous);
    expect(publicLocationWithHysteresis(wellOver, 'neighborhood', previous)).toEqual(snapPublicLocation(wellOver, 1_000));
    // A changed setting always takes effect at once.
    expect(publicLocationWithHysteresis(justOver, 'citywide', previous)?.precisionMeters).toBe(10_000);
    expect(publicLocationWithHysteresis(justOver, 'location-off', previous)).toBeNull();
  });
});
