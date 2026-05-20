**Features tested:** P2P P1 star-mode baseline, runtime flags, storage inspector endpoint, Settings storage panel

1. Starts a fresh single-user browser session with P2P flags left at their disabled defaults.
2. Calls `GET /api/debug/storage` on the worker's Gun/API server.
3. Verifies the topology remains `browser Gun client -> Node Gun hub -> HTTP/Socket API`.
4. Verifies `P2P_NODE_ENABLED` and `P2P_DIRECT_CHAT_ENABLED` are disabled and star persistence is durable by default.
5. Verifies representative Gun paths are classified as durable public, relay-only, and removable legacy storage.
6. Opens Settings and confirms the browser-visible Storage Inspector renders local browser storage and server path classifications.

This protects the compatibility baseline before later phases add a permissioned local node and direct P2P transport.
