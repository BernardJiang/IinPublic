# 78-techsupport-unblockable-every-route

covers: SPEC-3.8, SPEC-19.7

Attempts to block or filter TechSupport by every available route — the Contacts-tab support row
(whose settings dialog offers only a mute toggle, never block), the client-service
`WebUserService.blockUser` call, and the raw server `UserService.blockUser` API — and proves every
one fails: the support contact row and DM delivery survive all of them. Both client and server
enforce `assertBlockTargetAllowed` (src/shared/techsupport.ts), so this is defense in depth, not a
single choke point.
