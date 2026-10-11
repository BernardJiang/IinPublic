import {
  defaultQuietSettings,
  normalizeQuietSettings,
  quietStateFor,
  scheduleIsActive,
  type QuietSettings,
} from '../../shared/quiet-places';
import { filterTalkPeersByContactPolicy, talkContactPolicyAllowsPeer } from '../../shared/talk-contact-policy';
import { defaultDistanceUnit, formatDistance, talkRadiusOptions } from '../../web/ui/distance-units';

const HOME = { latitude: 32.7157, longitude: -117.1611 };
const at = (clock: string) => new Date(`2026-10-11T${clock}:00`);

function withHome(change: Partial<QuietSettings> = {}): QuietSettings {
  return {
    ...defaultQuietSettings(),
    places: [{ id: 'home', name: 'Home', ...HOME, radiusMeters: 500, action: 'blur' }],
    ...change,
  };
}

describe('quiet places', () => {
  it('goes quiet inside a place, using only the Resident GPS fix', () => {
    const settings = withHome();
    expect(quietStateFor(settings, { latitude: HOME.latitude + 0.003, longitude: HOME.longitude }, at('12:00')))
      .toEqual({ active: true, action: 'blur', reason: 'place', placeName: 'Home' });
    expect(quietStateFor(settings, { latitude: HOME.latitude + 0.01, longitude: HOME.longitude }, at('12:00')))
      .toEqual({ active: false });
    // A Traveler's chosen point is never "at home".
    expect(quietStateFor(settings, null, at('12:00'))).toEqual({ active: false });
  });

  it('applies the schedule across midnight and Quiet now everywhere', () => {
    const schedule = { enabled: true, start: '22:00', end: '07:00', action: 'blur' as const };
    expect(scheduleIsActive(schedule, at('23:30'))).toBe(true);
    expect(scheduleIsActive(schedule, at('06:59'))).toBe(true);
    expect(scheduleIsActive(schedule, at('07:00'))).toBe(false);
    expect(scheduleIsActive({ ...schedule, enabled: false }, at('23:30'))).toBe(false);
    expect(quietStateFor({ ...defaultQuietSettings(), quietNow: true }, null, at('12:00')))
      .toEqual({ active: true, action: 'blur', reason: 'quiet-now' });
  });

  it('lets Hide win when several reasons apply', () => {
    const settings = withHome({ quietNow: true, quietNowAction: 'hide' });
    expect(quietStateFor(settings, HOME, at('12:00'))).toEqual(expect.objectContaining({ active: true, action: 'hide' }));
  });

  it('drops malformed stored values instead of trusting them', () => {
    const normalized = normalizeQuietSettings({
      places: [{ id: 'x', name: 'Bad', latitude: 999, longitude: 0, radiusMeters: 500, action: 'blur' }],
      schedule: { enabled: true, start: '25:00', end: 'later', action: 'vanish' },
      quietNow: 'yes',
    });
    expect(normalized.places).toEqual([]);
    expect(normalized.schedule).toEqual({ enabled: true, start: '22:00', end: '07:00', action: 'blur' });
    expect(normalized.quietNow).toBe(false);
  });
});

describe('Talk audience', () => {
  const contacts = [{ userId: 'friend' }];
  const travelers = new Set(['tourist', 'friend']);

  it('Residents only skips known Travelers but always keeps contacts', () => {
    const filters = { residentsOnlyTalks: true };
    expect(talkContactPolicyAllowsPeer('tourist', filters, contacts, travelers)).toBe(false);
    expect(talkContactPolicyAllowsPeer('friend', filters, contacts, travelers)).toBe(true);
    expect(talkContactPolicyAllowsPeer('local', filters, contacts, travelers)).toBe(true);
    expect(filterTalkPeersByContactPolicy(['tourist', 'friend', 'local'], filters, contacts, travelers)).toEqual(['friend', 'local']);
  });

  it('Contacts only still wins over Residents only', () => {
    expect(filterTalkPeersByContactPolicy(['tourist', 'friend', 'local'], { contactsOnlyTalks: true, residentsOnlyTalks: true }, contacts, travelers))
      .toEqual(['friend']);
  });
});

describe('distance units', () => {
  it('defaults to miles only where miles are the norm', () => {
    expect(defaultDistanceUnit('en-US')).toBe('mi');
    expect(defaultDistanceUnit('en-GB')).toBe('mi');
    expect(defaultDistanceUnit('zh-CN')).toBe('km');
    expect(defaultDistanceUnit('fr')).toBe('km');
  });

  it('formats in one unit and keeps Talk radii stored in miles', () => {
    expect(formatDistance(400, 'km')).toBe('400 m');
    expect(formatDistance(11_600, 'km')).toBe('12 km');
    expect(formatDistance(1_609.344 * 10, 'mi')).toBe('10 mi');
    expect(talkRadiusOptions('mi').map((option) => option.miles)).toEqual([10, 100, 1_000]);
    expect(talkRadiusOptions('km')[0]).toEqual({ miles: 6.214, label: '10 km' });
  });
});
