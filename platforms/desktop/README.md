# IinPublic Desktop (Electron)

Runs the embedded P2P node (`dist/server/node-app/embedded-node.js`) in the
Electron main process and loads the prebuilt web SPA (`dist/web`) from
`http://127.0.0.1:<port>`. The local node dials the public hub for **discovery
only**; conversations are direct P2P.

## Develop

```bash
# from repo root — build the reused web + server bundles first
npm run build:web
npm run build:server

# then run the shell
cd platforms/desktop
npm install
npm start
```

## Package installers

```bash
cd platforms/desktop
npm run dist:win     # NSIS .exe
npm run dist:linux   # AppImage + .deb
npm run dist:mac     # .dmg
```

`electron-builder` bundles `dist/server`, `dist/web`, and `node_modules` as
`extraResources` so the packaged app is self-contained.

## How code is reused

| Layer            | Source                              | Reuse |
|------------------|-------------------------------------|-------|
| P2P / Gun node   | `src/server` via `embedded-node.ts` | 100%  |
| UI               | `src/web` → `dist/web`              | 100%  |
| Domain / match   | `src/shared`                        | 100%  |
| Native shell     | `platforms/desktop/main.js`         | new   |

The only shell-specific code is window creation and booting the node. No web
code is forked.
