import { avatarInnerHtml, isProfilePhoto } from '../../web/ui/profile-avatar';

const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

describe('profile avatar rendering', () => {
  it('renders approved image data URLs as images', () => {
    const photo = 'data:image/png;base64,aGVsbG8=';
    expect(isProfilePhoto(photo)).toBe(true);
    expect(avatarInnerHtml(photo, 'A', escapeHtml)).toContain('<img class="profile-avatar-image"');
    expect(avatarInnerHtml(photo, 'A', escapeHtml)).toContain(photo);
  });

  it('renders text headshots and rejects non-image URLs', () => {
    expect(isProfilePhoto('javascript:alert(1)')).toBe(false);
    expect(avatarInnerHtml('javascript:alert(1)', 'A', escapeHtml)).toBe('javascript:alert(1)');
    expect(avatarInnerHtml('', 'A', escapeHtml)).toBe('A');
  });
});
