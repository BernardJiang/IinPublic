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
npm run dist:win       # Windows x64 / Intel NSIS .exe + zip
npm run dist:win:arm64 # Windows ARM64 NSIS .exe + zip
npm run dist:win:all   # Windows x64 + ARM64
npm run dist:linux   # AppImage + .deb
npm run dist:mac     # .dmg
```

Use `dist:win` for ordinary Intel/AMD Windows notebooks. ARM64 is opt-in so a
build from an Apple Silicon Mac does not accidentally produce a Windows package
that will not run on x64 PCs.

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
