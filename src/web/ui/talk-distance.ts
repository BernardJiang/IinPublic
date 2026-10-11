import { LocationPrivacy } from '../../shared/location';
import type { GPSCoordinate } from '../../shared/types';
import { formatDistance } from './distance-units';

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
  if (!Number.isFinite(meters)) return '';
  const text = formatDistance(meters);
  return text.startsWith('<') ? text : `~${text}`;
}
