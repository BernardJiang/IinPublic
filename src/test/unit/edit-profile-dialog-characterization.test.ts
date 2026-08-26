/** @jest-environment jsdom */

import type { User } from '../../shared/types';
import {
  showEditProfileDialog,
  type EditProfileDialogOptions,
} from '../../web/ui/edit-profile-dialog';
import { uiText, type UiLanguage, type UiTranslationKey } from '../../web/ui/ui-translations';

const languageOptions = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: 'Chinese' },
  { code: 'es', label: 'Spanish' },
] as const;

const answeredAt = new Date('2026-08-20T12:00:00.000Z');

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'profile-user',
    stageName: 'Profile User',
    headshot: '😎',
    profile: [
      {
        id: 'existing-attribute',
        question: '<script>Unsafe question</script>',
        answer: 'Existing answer',
        isAuto: false,
        answeredAt,
        visibility: 'private',
      },
    ],
    reputation: {
      questionsAnswered: 0,
      talksSent: 0,
      matchesFound: 0,
      friendsCount: 0,
      mutualFriendsCount: 0,
      likedCount: 0,
      dislikedCount: 0,
      starRating: 0,
      reviewCount: 0,
      ageVerified: false,
      ageVerificationVotes: 0,
      blockCount: 0,
      isHidden: false,
    },
    location: { region: 'test', chatrooms: [] },
    languages: ['unsupported'],
    interests: [
      { id: 'one', name: 'Cycling', category: 'community', popularity: 1 },
      { id: 'two', name: 'Hiking', category: 'community', popularity: 1 },
      { id: 'three', name: 'Hiring', category: 'jobs', popularity: 1 },
    ],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastActive: new Date('2026-08-24T00:00:00.000Z'),
    ...overrides,
  };
}

function text(language: UiLanguage): EditProfileDialogOptions['text'] {
  return (key: UiTranslationKey) => uiText(language, key);
}

describe('edit-profile dialog characterization', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('renders localized controls, falls back to English, and preserves existing attribute identity', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(123_456);
    const onProfileChange = jest.fn(async () => undefined);
    const promise = showEditProfileDialog({
      user: makeUser(),
      uiLanguage: 'zh',
      languageOptions,
      text: text('zh'),
      onProfileChange,
    });

    expect(document.querySelector<HTMLInputElement>('.profile-language-option[value="en"]')?.checked).toBe(true);
    expect(document.querySelector('.profile-language-option[value="zh"]')?.parentElement?.textContent).toContain('中文');
    expect(document.querySelector<HTMLOptionElement>('#profile-interest-category-default option:checked')?.value).toBe('community');
    expect(document.querySelector<HTMLOptionElement>('#profile-interest-category-default option[value="community"]')?.textContent).toBe('社区');
    expect(document.querySelector<HTMLSelectElement>('.profile-visibility-select')?.value).toBe('private');
    expect(document.querySelector('script')).toBeNull();

    document.querySelector<HTMLButtonElement>('#add-profile-qa-btn')?.click();
    const rows = document.querySelectorAll<HTMLElement>('.profile-qa-row');
    const addedRow = rows[rows.length - 1]!;
    addedRow.querySelector<HTMLInputElement>('.profile-question-input')!.value = 'New question';
    addedRow.querySelector<HTMLInputElement>('.profile-answer-input')!.value = 'New answer';
    addedRow.querySelector<HTMLSelectElement>('.profile-visibility-select')!.value = 'contacts_only';
    document.querySelector<HTMLInputElement>('.profile-language-option[value="zh"]')!.checked = true;
    document.querySelector<HTMLInputElement>('#profile-interests-input')!.value = 'Photography, Custom';

    document.querySelector<HTMLFormElement>('#edit-profile-form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await promise;

    expect(onProfileChange).toHaveBeenCalledTimes(1);
    expect(onProfileChange).toHaveBeenCalledWith(
      'profile-user',
      expect.objectContaining({
        headshot: '😎',
        languages: ['en', 'zh'],
        interests: [
          expect.objectContaining({ name: 'Photography', category: 'community' }),
          expect.objectContaining({ name: 'Custom', category: 'community' }),
        ],
        profile: [
          expect.objectContaining({
            id: 'existing-attribute',
            answeredAt,
            visibility: 'private',
          }),
          expect.objectContaining({
            id: 'profile_123456_1',
            question: 'New question',
            answer: 'New answer',
            visibility: 'contacts_only',
          }),
        ],
      }),
    );
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('requires at least one supported language and keeps the dialog open for correction', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    const onProfileChange = jest.fn(async () => undefined);
    const promise = showEditProfileDialog({
      user: makeUser({ languages: ['en'] }),
      uiLanguage: 'en',
      languageOptions,
      text: text('en'),
      onProfileChange,
    });

    document.querySelector<HTMLInputElement>('.profile-language-option[value="en"]')!.checked = false;
    document.querySelector<HTMLFormElement>('#edit-profile-form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    expect(alertSpy).toHaveBeenCalledWith('Please enter at least one language.');
    expect(onProfileChange).not.toHaveBeenCalled();
    expect(document.querySelector('.modal-overlay')).not.toBeNull();

    document.querySelector<HTMLButtonElement>('#cancel-profile-btn')?.click();
    await promise;
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('rejects on update failure and leaves the dialog available for retry', async () => {
    const failure = new Error('update failed');
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    const promise = showEditProfileDialog({
      user: makeUser({ languages: ['en'] }),
      uiLanguage: 'en',
      languageOptions,
      text: text('en'),
      onProfileChange: async () => {
        throw failure;
      },
    });

    document.querySelector<HTMLFormElement>('#edit-profile-form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    await expect(promise).rejects.toBe(failure);
    expect(alertSpy).toHaveBeenCalledWith('Failed to update profile. Please try again.');
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
  });
});
