# stage1/59 — Responsive tab sweep

Covers TODO item **E** (redesign §8, catalog T7).

Sweeps every tab (Chatrooms, Contacts, Talks, Me, Settings) at each reference
width in the matrix — 320, 390, 768, 1024 — and once more with the Chinese UI at
390px. For every tab at every width it asserts:

1. The tab's root view renders and is visible.
2. The bottom nav stays visible.
3. No horizontal clipping (`scrollWidth - innerWidth <= 2`).
4. The AppBar primary action (create-talk ➕) is reachable — inline, or inside the
   `⋯` overflow panel (`app-bar-overflow-btn` → `create-talk-btn-overflow`).

The Chinese pass catches label-length overflow that English widths might not.
