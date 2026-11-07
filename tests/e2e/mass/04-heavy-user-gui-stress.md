# 04 — Heavy-user GUI stress

covers: SPEC-5.1

Seeds a data-heavy local user (many talks per type, answers, and contacts) and keeps every tab
— Talks, Me, Contacts, Chatrooms, Settings — responsive while rendering it. Tab switches are
timed and slow views are flagged against per-view limits; screenshots captured when
E2E_SCREENSHOT_DIR is set.
