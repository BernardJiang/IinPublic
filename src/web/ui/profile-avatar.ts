export function isProfilePhoto(value: string): boolean {
  return /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(value.trim());
}

export function avatarInnerHtml(
  headshot: string | undefined,
  fallback: string,
  escapeHtml: (text: string) => string,
): string {
  const value = String(headshot || '').trim();
  if (isProfilePhoto(value)) {
    return `<img class="profile-avatar-image" src="${escapeHtml(value)}" alt="">`;
  }
  return escapeHtml(value || fallback);
}
