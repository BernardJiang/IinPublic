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
    expect(uiText('zh', 'stageDialogNewName')).toBe('新昵称');
    expect(uiText('zh', 'profileDialogAttributes')).toBe('资料项目');
    expect(uiText('zh', 'interestCategoryCommunity')).toBe('社区');
    expect(uiText('zh', 'chatroomCreateTitle')).toBe('新建聊天室');
    expect(uiText('zh', 'chatroomRenameTitle')).toBe('重命名房间');
    expect(uiText('zh', 'broadcastCancelled')).toBe('已取消广播。');
    expect(uiText('zh', 'travelEnabled')).toContain('旅行模式');
    expect(uiText('zh', 'talksCreatedSent')).toContain('聊天室');
    expect(uiText('zh', 'talksCompletedOutcome')).toContain('结果');
    expect(uiText('zh', 'talksMatchNoticePrefix')).toBe('匹配！');
    expect(uiText('zh', 'editorCannotSave')).toContain('无法保存');
    expect(uiText('zh', 'settingsDistanceInvalid')).toContain('最小距离');
    expect(uiText('zh', 'settingsStageNameReserved')).toContain('保留');
    expect(uiText('zh', 'settingsPhotoInvalidType')).toContain('PNG');
    expect(uiText('zh', 'contactAgeVoteSubmitted')).toContain('年龄');
    expect(uiText('zh', 'contactBlockedNotice')).toContain('话题投递');
    expect(uiText('zh', 'contactMatchToChat')).toContain('开始对话');
    expect(languageOptionLabel('zh', 'en', 'English')).toBe('英语');
  });

  it('falls back to English for languages without a completed catalog', () => {
    expect(uiLanguageFromProfile(['es'])).toBe('en');
    expect(uiText(uiLanguageFromProfile(['es']), 'navTalks')).toBe('Talks');
  });
});
