import { LocationPrivacy } from '../../shared/location';
import type { GPSCoordinate } from '../../shared/types';

export function formatTalkDistanceFromAuthor(
  authorLocation: { latitude?: number; longitude?: number } | null | undefined,
  currentLocation: GPSCoordinate | null | undefined,
): string {
  if (!currentLocation || !authorLocation) return '';
  const latitude = Number(authorLocation.latitude);
  const longitude = Number(authorLocation.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
  const meters = LocationPrivacy.calculateDistance(currentLocation, {
    latitude,
    longitude,
    accuracy: 100,
    timestamp: new Date(),
  });
  const miles = meters / 1609.344;
  if (!Number.isFinite(miles)) return '';
  if (miles < 0.1) return '<0.1 mi';
  if (miles < 10) return `~${miles.toFixed(1)} mi`;
  return `~${Math.round(miles)} mi`;
}
