# 78-dm-inbox-affordance

covers: SPEC-13.1, SPEC-26.1

Verifies the cross-tab "pick a conversation" DM inbox affordance. While Jerry is on the Settings
tab (not Me, not Contacts), an arriving DM raises the badge on `#dm-inbox-btn` — reachable from
every tab and driven by the aggregate unread count, unlike the Me-tab-only badge. Clicking it
opens a modal listing senders with unread messages (correct sender id, unread count of 1).
Picking the sender navigates to that person's page, from which the DM thread entry opens the
exact conversation the message arrived in.
