import { shouldShowUpdateReminder } from '../../web/ui/app-update-reminder-view';

describe('shouldShowUpdateReminder', () => {
  it('is false when there is no server version at all', () => {
    expect(shouldShowUpdateReminder(null, '1.0.57', null)).toBe(false);
    expect(shouldShowUpdateReminder(undefined, '1.0.57', null)).toBe(false);
    expect(shouldShowUpdateReminder('', '1.0.57', null)).toBe(false);
  });

  it('is false when the server version is the same as or older than the running version', () => {
    expect(shouldShowUpdateReminder('1.0.57', '1.0.57', null)).toBe(false);
    expect(shouldShowUpdateReminder('1.0.56', '1.0.57', null)).toBe(false);
  });

  it('is true when the server version is newer and nothing has been dismissed', () => {
    expect(shouldShowUpdateReminder('1.0.58', '1.0.57', null)).toBe(true);
  });

  it('stays dismissed for the exact version that was already dismissed', () => {
    expect(shouldShowUpdateReminder('1.0.58', '1.0.57', '1.0.58')).toBe(false);
  });

  it('reminds again once an EVEN NEWER version is published than the one already dismissed', () => {
    expect(shouldShowUpdateReminder('1.0.59', '1.0.57', '1.0.58')).toBe(true);
  });

  it('a dismissed version that is now stale (server rolled back or matches running) stays hidden', () => {
    expect(shouldShowUpdateReminder('1.0.57', '1.0.57', '1.0.58')).toBe(false);
  });
});
