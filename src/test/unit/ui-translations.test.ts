import { languageOptionLabel, uiLanguageFromProfile, uiText } from '../../web/ui/ui-translations';

describe('UI translations', () => {
  it('uses Chinese for a Chinese primary profile language', () => {
    expect(uiLanguageFromProfile(['zh', 'en'])).toBe('zh');
    expect(uiText('zh', 'navSettings')).toBe('设置');
    expect(languageOptionLabel('zh', 'en', 'English')).toBe('英语');
  });

  it('falls back to English for languages without a completed catalog', () => {
    expect(uiLanguageFromProfile(['es'])).toBe('en');
    expect(uiText(uiLanguageFromProfile(['es']), 'navTalks')).toBe('Talks');
  });
});
