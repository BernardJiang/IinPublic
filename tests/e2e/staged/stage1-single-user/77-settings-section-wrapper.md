# 77-settings-section-wrapper

covers: SPEC-26.1, SPEC-26.2

Settings tab drill-down: every section renders through the shared `renderSettingsSection()`
wrapper (one `.settings-section` with a static title/subtitle header, no leftover ad hoc
`<section>` markup), and the tab is a menu-first drill-down — tapping a menu item hides the menu
and every other section, leaving just that section plus a back button, the same list-then-detail
pattern as Chatrooms/Contacts. Verifies the wrapper landed everywhere, menu/detail navigation
works, and sampled controls across sections (profile, credit, content filters, talk behavior,
location, linked devices, erase device, storage inspector) still read/write state.
