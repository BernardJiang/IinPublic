import {
  buildCustomPromptTalkDraft,
  FEATURED_TALK_TEMPLATES,
  STARTER_TALK_CATALOG_VERSION,
  TALK_TEMPLATES,
} from '../../web/ui/talk-templates';

describe('starter Talk catalog', () => {
  it('features six distinct real-life starters across tag, flow, survey, and route', () => {
    expect(FEATURED_TALK_TEMPLATES.map((template) => template.id)).toEqual([
      'sharedInterest',
      'activityMeetup',
      'quickPoll',
      'buySell',
      'job',
      'lostFound',
    ]);
    expect(new Set(FEATURED_TALK_TEMPLATES.map((template) => template.type))).toEqual(
      new Set(['tag', 'flow', 'survey', 'route']),
    );
    expect(TALK_TEMPLATES.every((template) => template.version === STARTER_TALK_CATALOG_VERSION)).toBe(true);
  });

  it('builds fresh, localized drafts without persistence or delivery metadata', () => {
    for (const template of FEATURED_TALK_TEMPLATES) {
      const english = template.build('en');
      const chinese = template.build('zh');
      expect(english).not.toBe(template.build('en'));
      expect(english.language).toBe('en');
      expect(chinese.language).toBe('zh');
      expect(english.questions.length).toBeGreaterThan(0);
      expect(english).not.toHaveProperty('id');
      expect(english).not.toHaveProperty('author');
      expect(english).not.toHaveProperty('timestamp');
      expect(english).not.toHaveProperty('broadcast');
      expect(english).not.toHaveProperty('recipients');
    }
  });

  it('turns custom copy into an editable flow draft without publishing it', () => {
    const draft = buildCustomPromptTalkDraft('  Need a tennis partner?  ', 'en');
    expect(draft).toEqual(expect.objectContaining({
      type: 'flow',
      title: 'Need a tennis partner?',
      language: 'en',
    }));
    expect(draft.questions[0].text).toBe('Need a tennis partner?');
    expect(draft).not.toHaveProperty('id');
  });
});
