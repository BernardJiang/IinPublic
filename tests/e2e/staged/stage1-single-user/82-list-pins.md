# 82-list-pins

covers: SPEC-13.1, SPEC-26.2

Verifies the manual pin/unpin affordance is uniform across the three main list tabs: Contacts,
Talks, and Me (answers). In each tab, long-pressing a row and using the AppBar's 📌 pins it above
the active sort order and shows a pin badge; a full document reload proves the pin is a persisted
preference, not a DOM-only move; unpinning restores the underlying sort order (recent /
answered-desc). The spec seeds deterministic old/new rows in all three lists so the
pin-overrides-sort behavior is directly observable.
