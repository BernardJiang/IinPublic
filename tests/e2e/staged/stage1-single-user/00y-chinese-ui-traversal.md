# Test: Chinese UI Localization Traversal (D2)

**File:** 00y-chinese-ui-traversal.spec.ts  
**Features tested:** App-wide Chinese localization — nav labels, action bars, filters, modals. Persistence across reload. Switch back to English.

---

## What this test does (in plain English):

Switches app UI from English to Chinese, then walks every tab verifying all localized labels are correct. Reloads the page to confirm persistence. Finally restores English.

1. **Setup:** Single ordinary browser user with the TechSupport root baseline present.
2. **Switch to Chinese:** Settings → UI language → `zh`. Verifies nav labels change to `['聊天室', '联系人', '话题', '我的', '设置']` and localStorage key updates to `'zh'`.
3. **Chatrooms tab in zh:** Action bar shows 新建房间, 返回主页, 广播.
4. **Contacts tab in zh:** Filter option shows "全部关系", sort shows "最近".
5. **Talks tab in zh:** Creator replies panel header "我的话题回复", filter placeholder "昵称或话题", sort "加权表现", language filter shows "中文", talk editor modal title "创建话题", language dropdown "中文".
6. **Me tab in zh:** Preferences button "偏好设置", answer filters "全部" and "条件".
7. **Settings tab in zh:** Content includes "界面语言" and "个人资料语言", confirms value is `'zh'`. Grammar filter visible (unchanged — code label).
8. **Reload persists Chinese:** After full page reload, nav labels still show `ZH_NAV` array; localStorage still `'zh'`.
9. **Switch back to English:** Settings → UI language → `en`. Nav labels restore to English, Talks tab language filter shows "Chinese" again.

## Verifications:

- ✅ All five nav buttons fully localized in Chinese
- ✅ Every action bar, filter, dropdown, and modal surface rendered in zh
- ✅ Talk editor dialog fully localized (title + language options)
- ✅ Chinese locale persists across page reload
- ✅ English restoration works cleanly in all tabs

> **Why this matters:** Validates the complete i18n pipeline — not just nav labels but every interactive element across all five tabs. Reload persistence proves the setting survives a hard refresh.

---

**Helpers used:** `clearGunForStage1Spec`, `injectIdbClear`, `gotoWebApp`, `afterNav`, `afterSync`, `reloadAppReady`
