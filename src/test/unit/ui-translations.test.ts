import { languageOptionLabel, uiLanguageFromProfile, uiText } from '../../web/ui/ui-translations';

describe('UI translations', () => {
  it('uses Chinese for a Chinese primary profile language', () => {
    expect(uiLanguageFromProfile(['zh', 'en'])).toBe('zh');
    expect(uiText('zh', 'navSettings')).toBe('设置');
    expect(uiText('zh', 'repliesGroupTalk')).toBe('按话题分组');
    expect(uiText('zh', 'meNoAnswers')).toContain('回答');
    expect(uiText('zh', 'editorRouteAddChild')).toBe('+ 子问题');
    expect(uiText('zh', 'editorRouteKindMatch')).toBe('匹配');
    expect(uiText('zh', 'storageLocalNodeSupervisor')).toBe('本地节点管理器');
    expect(uiText('zh', 'storagePurposeChatrooms')).toContain('聊天室');
    expect(uiText('zh', 'storageDisabled')).toBe('已禁用');
    expect(uiText('zh', 'meProfileVisibilityHelp')).toContain('可见范围');
    expect(uiText('zh', 'meCreditHelp')).toContain('信誉摘要');
    expect(uiText('zh', 'meTrendNoData')).toContain('广播定向数据');
    expect(languageOptionLabel('zh', 'en', 'English')).toBe('英语');
  });

  it('falls back to English for languages without a completed catalog', () => {
    expect(uiLanguageFromProfile(['es'])).toBe('en');
    expect(uiText(uiLanguageFromProfile(['es']), 'navTalks')).toBe('Talks');
  });
});
