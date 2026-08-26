import type {
  ProfileAttributeVisibility,
  QuestionAnswer,
  Tag,
  TagCategory,
  User,
} from '../../shared/types';
import { INTEREST_CATEGORY_LABELS, INTEREST_CATEGORY_SELECT_ORDER } from '../../shared/interest-catalog';
import { normalizeProfileAttributeVisibility } from '../../shared/profile-privacy';
import { interestsFromCommaInput } from '../../shared/user-utils';
import { escapeHtml } from './ui-formatters';
import {
  languageOptionLabel,
  type UiLanguage,
  type UiTranslationKey,
} from './ui-translations';

export interface EditProfileUpdates {
  headshot?: string;
  languages: string[];
  profile: QuestionAnswer[];
  interests: Tag[];
}

export interface EditProfileLanguageOption {
  code: string;
  label: string;
}

export interface EditProfileDialogOptions {
  user: User;
  uiLanguage: UiLanguage;
  languageOptions: readonly EditProfileLanguageOption[];
  text: (key: UiTranslationKey) => string;
  onProfileChange?: (
    userId: string,
    updates: EditProfileUpdates,
  ) => void | Promise<void>;
}

function formatProfileVisibility(
  visibility: ProfileAttributeVisibility,
  text: EditProfileDialogOptions['text'],
): string {
  if (visibility === 'contacts_only') return text('meVisibilityContacts');
  if (visibility === 'private') return text('meVisibilityPrivate');
  return text('meVisibilityEveryone');
}

function formatInterestCategory(
  category: TagCategory,
  text: EditProfileDialogOptions['text'],
): string {
  const keys: Record<TagCategory, UiTranslationKey> = {
    community: 'interestCategoryCommunity',
    discussion: 'interestCategoryDiscussion',
    personals: 'interestCategoryPersonals',
    jobs: 'interestCategoryJobs',
    gigs: 'interestCategoryGigs',
    resumes: 'interestCategoryResumes',
    'for-sale': 'interestCategoryForSale',
    housing: 'interestCategoryHousing',
    services: 'interestCategoryServices',
    other: 'interestCategoryOther',
  };
  return text(keys[category]);
}

export function showEditProfileDialog(options: EditProfileDialogOptions): Promise<void> {
  const { user, uiLanguage, languageOptions, text, onProfileChange } = options;
  const currentProfile = Array.isArray(user.profile) ? user.profile : [];
  const supportedLanguageCodes = new Set(languageOptions.map((language) => language.code));
  const currentLanguages = (Array.isArray(user.languages) ? user.languages : [])
    .map((language) => String(language).toLowerCase())
    .filter((language) => supportedLanguageCodes.has(language));
  if (currentLanguages.length === 0) currentLanguages.push('en');
  const languageOptionsHtml = languageOptions.map(
    (language) => `
      <label style="display:flex;align-items:center;gap:6px;font-size:0.9em;padding:6px 10px;border:1px solid var(--border-strong);border-radius:999px;background:var(--surface);">
        <input type="checkbox" class="profile-language-option" value="${language.code}" ${currentLanguages.includes(language.code) ? 'checked' : ''}>
        <span>${escapeHtml(languageOptionLabel(uiLanguage, language.code, language.label))}</span>
      </label>
    `,
  ).join('');
  const currentHeadshot = String(user.headshot || '').trim();
  const currentInterests = Array.isArray(user.interests) ? user.interests : [];
  const interestsFieldValue = currentInterests
    .map((tag) => String(tag.name || '').trim())
    .filter(Boolean)
    .join(', ');
  const dominantInterestCategory = (): TagCategory => {
    const categories = currentInterests.map((tag) => tag.category).filter(Boolean) as TagCategory[];
    if (categories.length === 0) return 'other';
    const counts = new Map<TagCategory, number>();
    for (const category of categories) counts.set(category, (counts.get(category) || 0) + 1);
    let best: TagCategory = 'other';
    let count = 0;
    for (const [category, categoryCount] of counts) {
      if (categoryCount > count) {
        count = categoryCount;
        best = category;
      }
    }
    return best;
  };
  const defaultInterestCategory = dominantInterestCategory();
  const visibilityOptionsHtml = (current: ProfileAttributeVisibility) =>
    (['public', 'contacts_only', 'private'] as const)
      .map(
        (visibility) =>
          `<option value="${visibility}"${visibility === current ? ' selected' : ''}>${escapeHtml(formatProfileVisibility(visibility, text))}</option>`,
      )
      .join('');
  const interestCategoryOptionsHtml = INTEREST_CATEGORY_SELECT_ORDER.map(
    (category) =>
      `<option value="${category}"${category === defaultInterestCategory ? ' selected' : ''}>${escapeHtml(
        formatInterestCategory(category, text),
      )}</option>`,
  ).join('');

  return new Promise((resolve, reject) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    const profileRowsHtml = currentProfile.length > 0
      ? currentProfile
          .map(
            (qa) => `
              <div class="profile-qa-row" data-qa-id="${escapeHtml(qa.id)}" style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(154px,auto) auto; gap:8px; margin-bottom:8px; align-items:start;">
                <input type="text" class="form-input profile-question-input" value="${escapeHtml(qa.question)}" placeholder="${escapeHtml(text('profileDialogQuestion'))}">
                <input type="text" class="form-input profile-answer-input" value="${escapeHtml(qa.answer)}" placeholder="${escapeHtml(text('profileDialogAnswer'))}">
                <select class="form-input profile-visibility-select" title="${escapeHtml(text('profileDialogVisibilityTitle'))}">${visibilityOptionsHtml(normalizeProfileAttributeVisibility(qa.visibility))}</select>
                <button type="button" class="btn remove-profile-qa-btn" style="background:var(--danger);">${text('profileDialogRemove')}</button>
              </div>
            `,
          )
          .join('')
      : `
        <div class="profile-qa-row" data-qa-id="" style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(154px,auto) auto; gap:8px; margin-bottom:8px; align-items:start;">
          <input type="text" class="form-input profile-question-input" placeholder="${escapeHtml(text('profileDialogQuestion'))}">
          <input type="text" class="form-input profile-answer-input" placeholder="${escapeHtml(text('profileDialogAnswer'))}">
          <select class="form-input profile-visibility-select" title="${escapeHtml(text('profileDialogVisibilityTitle'))}">${visibilityOptionsHtml('public')}</select>
          <button type="button" class="btn remove-profile-qa-btn" style="background:var(--danger);">${text('profileDialogRemove')}</button>
        </div>
      `;
    const headshotChoices = ['🙂', '😎', '🤠', '🎾', '☕', '🌟', '🐱', '🦊'];
    modal.innerHTML = `
      <div class="modal-content size-l modal-fullscreen" style="max-width:760px;">
        <div class="modal-header">
          <h2 class="modal-title">${text('editProfile')}</h2>
          <p>${escapeHtml(text('profileDialogDescription'))}</p>
        </div>
        <form id="edit-profile-form">
          <div class="form-group">
            <label class="form-label">${text('profileDialogHeadshot')}</label>
            <div style="display:flex; flex-wrap:wrap; gap:8px;" id="headshot-choice-group">
              ${headshotChoices
                .map(
                  (choice) => `
                    <label style="display:flex; align-items:center; justify-content:center; width:52px; height:52px; border:1px solid var(--border-strong); border-radius:14px; cursor:pointer; font-size:1.5em; background:${choice === currentHeadshot ? 'var(--accent-soft)' : 'white'};">
                      <input type="radio" name="profile-headshot" value="${choice}" ${choice === currentHeadshot ? 'checked' : ''} style="display:none;">
                      <span>${choice}</span>
                    </label>
                  `,
                )
                .join('')}
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">${text('languagesLabel')}</label>
            <div id="profile-languages-select" data-testid="profile-languages-select" style="display:flex;flex-wrap:wrap;gap:8px;">
              ${languageOptionsHtml}
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">${text('interestsLabel')}</label>
            <input type="text" class="form-input" id="profile-interests-input" value="${escapeHtml(interestsFieldValue)}" placeholder="${escapeHtml(text('profileDialogInterestPlaceholder'))}">
            <label class="form-label" style="margin-top:10px;">${text('profileDialogDefaultCategory')}</label>
            <select class="form-input" id="profile-interest-category-default">${interestCategoryOptionsHtml}</select>
            <small style="color:#666;font-size:0.85em;">${text('profileDialogCategoryHelp')}</small>
          </div>
          <div class="form-group">
            <label class="form-label">${text('profileDialogAttributes')}</label>
            <div id="profile-qa-list">${profileRowsHtml}</div>
            <button type="button" class="btn" id="add-profile-qa-btn">${text('profileDialogAddAttribute')}</button>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn" id="cancel-profile-btn" style="background: var(--text-tertiary);">${text('stageDialogCancel')}</button>
            <button type="submit" class="btn" id="save-profile-btn">${text('profileDialogSave')}</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => {
      if (document.body.contains(modal)) document.body.removeChild(modal);
    };

    const bindRemoveButtons = () => {
      modal.querySelectorAll('.remove-profile-qa-btn').forEach((button) => {
        button.addEventListener('click', () => {
          const row = (button as HTMLElement).closest('.profile-qa-row');
          row?.remove();
        });
      });
    };
    bindRemoveButtons();

    const addButton = document.getElementById('add-profile-qa-btn') as HTMLButtonElement | null;
    addButton?.addEventListener('click', () => {
      const list = document.getElementById('profile-qa-list');
      if (!list) return;
      const row = document.createElement('div');
      row.className = 'profile-qa-row';
      row.setAttribute('data-qa-id', '');
      row.style.cssText =
        'display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(154px,auto) auto; gap:8px; margin-bottom:8px; align-items:start;';
      row.innerHTML = `
        <input type="text" class="form-input profile-question-input" placeholder="${escapeHtml(text('profileDialogQuestion'))}">
        <input type="text" class="form-input profile-answer-input" placeholder="${escapeHtml(text('profileDialogAnswer'))}">
        <select class="form-input profile-visibility-select" title="${escapeHtml(text('profileDialogVisibilityTitle'))}">${visibilityOptionsHtml('public')}</select>
        <button type="button" class="btn remove-profile-qa-btn" style="background:var(--danger);">${text('profileDialogRemove')}</button>
      `;
      list.appendChild(row);
      bindRemoveButtons();
    });

    const cancelButton = document.getElementById('cancel-profile-btn') as HTMLButtonElement | null;
    cancelButton?.addEventListener('click', () => {
      close();
      resolve();
    });

    const form = document.getElementById('edit-profile-form') as HTMLFormElement | null;
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const selectedHeadshot = (
        modal.querySelector('input[name="profile-headshot"]:checked') as HTMLInputElement | null
      )?.value?.trim() || '';
      const languages = Array.from(
        modal.querySelectorAll<HTMLInputElement>('.profile-language-option:checked'),
      )
        .map((language) => language.value)
        .filter((language) => supportedLanguageCodes.has(language));
      const interestsRaw = (
        document.getElementById('profile-interests-input') as HTMLInputElement | null
      )?.value || '';
      const defaultCategoryRaw = (
        document.getElementById('profile-interest-category-default') as HTMLSelectElement | null
      )?.value;
      const defaultCategory: TagCategory =
        defaultCategoryRaw && defaultCategoryRaw in INTEREST_CATEGORY_LABELS
          ? (defaultCategoryRaw as TagCategory)
          : 'other';
      const interests = interestsFromCommaInput(interestsRaw, defaultCategory);
      const profileById = new Map(currentProfile.map((qa) => [qa.id, qa]));
      const profile: QuestionAnswer[] = Array.from(modal.querySelectorAll('.profile-qa-row'))
        .map((row, index) => {
          const question = (
            (row.querySelector('.profile-question-input') as HTMLInputElement | null)?.value || ''
          ).trim();
          const answer = (
            (row.querySelector('.profile-answer-input') as HTMLInputElement | null)?.value || ''
          ).trim();
          if (!question || !answer) return null;
          const rowElement = row as HTMLElement;
          const attributeId = rowElement.dataset.qaId?.trim();
          const previous = attributeId ? profileById.get(attributeId) : undefined;
          const visibilityRaw = (
            row.querySelector('.profile-visibility-select') as HTMLSelectElement | null
          )?.value;
          const visibility = normalizeProfileAttributeVisibility(visibilityRaw);
          return {
            id: attributeId || `profile_${Date.now()}_${index}`,
            question,
            answer,
            isAuto: false,
            answeredAt: previous?.answeredAt || new Date(),
            ...(visibility === 'public' ? {} : { visibility }),
          } as QuestionAnswer;
        })
        .filter((item): item is QuestionAnswer => !!item);

      if (languages.length === 0) {
        alert(text('profileDialogLanguageRequired'));
        return;
      }

      try {
        await onProfileChange?.(user.id, {
          ...(selectedHeadshot ? { headshot: selectedHeadshot } : {}),
          languages,
          profile,
          interests,
        });
        close();
        resolve();
      } catch (error) {
        alert(text('profileDialogUpdateFailed'));
        reject(error);
      }
    });
  });
}
