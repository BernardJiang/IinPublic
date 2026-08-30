/**
 * Approximate city centres for the built-in leaf chatrooms.
 *
 * These coordinates are intentionally room-level, not user-level. They let the UI place
 * public chatrooms on a map without storing or exposing anybody's precise location.
 */
export type ChatroomMapLocation = Readonly<{
  latitude: number;
  longitude: number;
}>;

export const CHATROOM_MAP_LOCATIONS: Readonly<Record<string, ChatroomMapLocation>> = {
  'san-diego': { latitude: 32.7157, longitude: -117.1611 },
  'los-angeles': { latitude: 34.0522, longitude: -118.2437 },
  'new-york-city': { latitude: 40.7128, longitude: -74.006 },
  buffalo: { latitude: 42.8864, longitude: -78.8784 },
  austin: { latitude: 30.2672, longitude: -97.7431 },
  houston: { latitude: 29.7604, longitude: -95.3698 },
  toronto: { latitude: 43.6532, longitude: -79.3832 },
  ottawa: { latitude: 45.4215, longitude: -75.6972 },
  vancouver: { latitude: 49.2827, longitude: -123.1207 },
  'victoria-bc': { latitude: 48.4284, longitude: -123.3656 },
  'sao-paulo-city': { latitude: -23.5505, longitude: -46.6333 },
  campinas: { latitude: -22.9056, longitude: -47.0608 },
  'rio-de-janeiro-city': { latitude: -22.9068, longitude: -43.1729 },
  niteroi: { latitude: -22.8832, longitude: -43.1034 },
  'buenos-aires-city': { latitude: -34.6037, longitude: -58.3816 },
  'la-plata': { latitude: -34.9215, longitude: -57.9545 },
  'cordoba-city': { latitude: -31.4201, longitude: -64.1888 },
  'villa-carlos-paz': { latitude: -31.4241, longitude: -64.4978 },
  london: { latitude: 51.5074, longitude: -0.1278 },
  manchester: { latitude: 53.4808, longitude: -2.2426 },
  edinburgh: { latitude: 55.9533, longitude: -3.1883 },
  glasgow: { latitude: 55.8642, longitude: -4.2518 },
  munich: { latitude: 48.1351, longitude: 11.582 },
  nuremberg: { latitude: 49.4521, longitude: 11.0767 },
  'berlin-city': { latitude: 52.52, longitude: 13.405 },
  potsdam: { latitude: 52.3906, longitude: 13.0645 },
  guangzhou: { latitude: 23.1291, longitude: 113.2644 },
  shenzhen: { latitude: 22.5431, longitude: 114.0579 },
  'beijing-city': { latitude: 39.9042, longitude: 116.4074 },
  tongzhou: { latitude: 39.9025, longitude: 116.6564 },
  'tokyo-city': { latitude: 35.6762, longitude: 139.6503 },
  hachioji: { latitude: 35.6663, longitude: 139.3158 },
  osaka: { latitude: 34.6937, longitude: 135.5023 },
  kyoto: { latitude: 35.0116, longitude: 135.7681 },
  'lagos-city': { latitude: 6.5244, longitude: 3.3792 },
  ikeja: { latitude: 6.6018, longitude: 3.3515 },
  abuja: { latitude: 9.0765, longitude: 7.3986 },
  gwagwalada: { latitude: 8.9434, longitude: 7.0811 },
  'cape-town': { latitude: -33.9249, longitude: 18.4241 },
  stellenbosch: { latitude: -33.9321, longitude: 18.8602 },
  johannesburg: { latitude: -26.2041, longitude: 28.0473 },
  pretoria: { latitude: -25.7479, longitude: 28.2293 },
  sydney: { latitude: -33.8688, longitude: 151.2093 },
  'newcastle-au': { latitude: -32.9283, longitude: 151.7817 },
  melbourne: { latitude: -37.8136, longitude: 144.9631 },
  geelong: { latitude: -38.1499, longitude: 144.3617 },
  'auckland-city': { latitude: -36.8509, longitude: 174.7645 },
  manukau: { latitude: -36.993, longitude: 174.8798 },
  'wellington-city': { latitude: -41.2866, longitude: 174.7756 },
  'lower-hutt': { latitude: -41.2127, longitude: 174.8997 },
};

export function getChatroomMapLocation(chatroomId: string): ChatroomMapLocation | undefined {
  return CHATROOM_MAP_LOCATIONS[chatroomId];
}
