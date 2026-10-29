# 96 — One device core across browser tabs

OPEN-91 P6. The tests use actual worker bundles, Gun and IndexedDB in one browser context/origin.

- Three tabs write different records concurrently, then each reads the complete set.
- Identical subscription IDs belong to separate tabs; unsubscribing one preserves the others.
- Tabs sharing the owner's identity can decrypt the same private record. Logging out one does not
  log out another, and a different identity cannot replace the active signer.
- Closing the first tab preserves the remaining tabs' data and restores their sessions when the
  storage owner or worker session changes. Deletions and acknowledged writes survive reopening.
- Both named SharedWorker and the Web Locks/BroadcastChannel dedicated-worker fallback are tested.
- Normal app startup in two tabs preserves identity, both tabs' confirmed edits, and private access
  after the first tab closes. Simultaneous first startup must create only one device identity.

Run the spec with `chromium`, or enable `E2E_WEBKIT_SUITE=1 E2E_FIREFOX_SUITE=1` and select the
`webkit-suite` and `firefox-suite` projects. Unconfirmed requests interrupted by owner replacement
may fail; writes are never replayed automatically merely because their acknowledgement was lost.
