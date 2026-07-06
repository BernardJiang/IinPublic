# IinPublic Port Usage Scenarios

This document describes the intended port model from simple local development
through production. The goal is that every runtime is explicit about two things:

- where its UI is loaded from
- which Gun/server hub it joins

## Port Roles

| Port / range | Role | Owner | Notes |
| --- | --- | --- | --- |
| `3001` | TechSupport browser UI | webpack/static web server | Local browser access to the IinPublic web app during shared development. |
| `3002`, `3003`, ... | Additional browser user UIs | webpack/static web servers | Each port represents another browser end user in shared development. |
| `8080` | Shared development Gun/server hub | `src/server` | The local shared network hub. Browser users, native app users, and remote LAN users should all join this hub in shared-dev scenarios. |
| `8081`, `8082`, ... | Isolated E2E worker hubs | `src/server` | Used by Playwright worker isolation, not by the shared manual development network. |
| `8088`, `8089`, ... | Native app embedded Node servers | Electron/nodejs-mobile app instance | Each native app instance owns one loopback server and serves its own UI from the same origin. |
| `443` | Production web + Gun endpoint | `www.iinpublic.com` | Production should expose the app and `/gun` over HTTPS/WSS. |

## Two Development Modes

IinPublic has two different local modes that must not be confused.

### Shared Development Network

This is the manual/product-development mode. Many identities join one shared
local network:

```text
browser TechSupport UI :3001  -> shared hub :8080/gun
browser user 1 UI     :3002  -> shared hub :8080/gun
browser user 2 UI     :3003  -> shared hub :8080/gun
Mac app user 1 UI     :8088  -> embedded Node :8088 -> shared hub :8080/gun
Mac app user 2 UI     :8089  -> embedded Node :8089 -> shared hub :8080/gun
remote LAN browser    :300x  -> shared hub http://<dev-host>:8080/gun
Windows app           :8088  -> embedded Node :8088 -> shared hub http://<dev-host>:8080/gun
Android/iOS app       :8088  -> embedded Node :8088 -> shared hub http://<dev-host>:8080/gun
```

In this mode, UI ports identify users, but `8080` is the single shared Gun
network.

### Isolated E2E Worker Network

This is the automated Playwright mode. Each worker gets its own private network
so tests do not leak Gun graph state into each other:

```text
worker 0: web :3001 -> gun :8080
worker 1: web :3002 -> gun :8081
worker 2: web :3003 -> gun :8082
```

This is correct for parallel E2E, but wrong for manual shared-development
scenarios where `3002` and `3003` should join the same `8080` hub.

## Scenario Ladder

### 1. Single TechSupport Browser

```text
TechSupport browser -> http://localhost:3001
web client          -> http://localhost:8080/gun
```

Use this for the simplest local development loop. `3001` is the local web UI.
`8080` is the local Gun/server hub.

### 2. TechSupport + One Browser End User

```text
TechSupport browser -> http://localhost:3001 -> :8080/gun
end user browser    -> http://localhost:3002 -> :8080/gun
```

There are two browser instances and two identities, but one shared hub.

### 3. TechSupport + Two Browser End Users

```text
TechSupport browser -> http://localhost:3001 -> :8080/gun
end user browser 1  -> http://localhost:3002 -> :8080/gun
end user browser 2  -> http://localhost:3003 -> :8080/gun
```

This is the basic three-browser shared-dev setup.

### 4. Add One Native App User on One Mac Mini

```text
Mac app window      -> http://127.0.0.1:8088
Mac embedded Node   -> listens on 127.0.0.1:8088
Mac embedded Node   -> peers to http://<dev-host>:8080/gun
browser users       -> :3001/:3002/:3003 -> :8080/gun
```

The native app does not need a separate frontend port. Its embedded Node server
serves the prebuilt SPA and `/gun` from the same port. For desktop this is
currently `IINPUBLIC_LOCAL_PORT`, defaulting to `8088`.

The app should be launched with:

```bash
open -n /Applications/IinPublic.app \
  --env IINPUBLIC_LOCAL_PORT=8088 \
  --env IINPUBLIC_HUB_GUN_URL=http://<dev-host>:8080/gun
```

### 5. Add Two Native App Users on One Mac Mini

```text
Mac app user 1      -> http://127.0.0.1:8088 -> http://<dev-host>:8080/gun
Mac app user 2      -> http://127.0.0.1:8089 -> http://<dev-host>:8080/gun
browser TechSupport -> :3001 -> :8080/gun
browser user 1      -> :3002 -> :8080/gun
browser user 2      -> :3003 -> :8080/gun
```

There are five identities. If both apps run on the same Mac mini, they share
one machine IP address, but they must have separate app data directories and
separate embedded-node ports.

Launch shape:

```bash
open -n /Applications/IinPublic.app \
  --env IINPUBLIC_LOCAL_PORT=8088 \
  --env IINPUBLIC_USER_DATA_DIR=/tmp/iinpublic-user-a \
  --env IINPUBLIC_HUB_GUN_URL=http://<dev-host>:8080/gun

open -n /Applications/IinPublic.app \
  --env IINPUBLIC_LOCAL_PORT=8089 \
  --env IINPUBLIC_USER_DATA_DIR=/tmp/iinpublic-user-b \
  --env IINPUBLIC_HUB_GUN_URL=http://<dev-host>:8080/gun
```

`IINPUBLIC_USER_DATA_DIR` is the desired test/dev control for isolated desktop
profiles. Desktop should support it so multiple app instances do not share the
same Electron `userData` directory.

### 6. Add a User in a Different Browser

Different browser engines or profiles should still work. The user identity is
stored in that browser profile. The browser UI may use `3002`, `3003`, or any
assigned UI port, but in shared development it should still join `8080/gun`.

Examples:

```text
Chrome profile A    -> http://localhost:3002 -> :8080/gun
Firefox/Safari      -> http://localhost:3003 -> :8080/gun
```

### 7. Add a Browser User from Another PC on the Same Intranet

The remote PC opens the dev machine's UI host:

```text
remote browser -> http://<dev-host-lan-ip>:3002
web client     -> http://<dev-host-lan-ip>:8080/gun
```

The dev host must bind the web UI and hub to an address reachable from the LAN,
and the firewall must allow `300x` and `8080`.

### 8. Add a Windows App User on a Windows PC

```text
Windows app window    -> http://127.0.0.1:8088
Windows embedded Node -> 127.0.0.1:8088
Windows embedded Node -> http://<dev-host-lan-ip>:8080/gun
```

The Windows app's local `8088` is loopback on the Windows PC. It does not
collide with the Mac mini's `8088`, because they are on different machines.

### 9. Add a Third Desktop PC

Each desktop app uses its own loopback embedded-node port on its own machine:

```text
desktop PC 1 app -> local :8088 -> http://<dev-host>:8080/gun
desktop PC 2 app -> local :8088 -> http://<dev-host>:8080/gun
desktop PC 3 app -> local :8088 -> http://<dev-host>:8080/gun
```

Same local port is fine across machines. Only multiple app instances on the
same machine need `8089`, `8090`, etc.

### 10. Add a Smartphone

Android and iOS follow the same embedded-node pattern:

```text
mobile WebView      -> http://127.0.0.1:<mobile-local-port>
nodejs-mobile Node  -> serves UI + /gun on <mobile-local-port>
nodejs-mobile Node  -> http://<dev-host>:8080/gun
```

The mobile local port should be auto-selected if the default is unavailable.
The hub URL must point at a LAN-reachable dev host, not `localhost`, because
`localhost` on the phone means the phone itself.

### 11. Production

Production should collapse the public entrypoints behind HTTPS:

```text
browser user      -> https://www.iinpublic.com
browser Gun peer  -> https://www.iinpublic.com/gun or wss://www.iinpublic.com/gun
native app Node   -> local :8088 -> https://www.iinpublic.com/gun
```

Production should remain compatible with development by using the same config
knobs:

- browser bundle can derive same-origin `/gun` in production
- native app can override hub with `IINPUBLIC_HUB_GUN_URL`
- embedded app can override local port with `IINPUBLIC_LOCAL_PORT`

## Automatic Port Assignment Logic

The port assignment logic should be explicit about the network mode.

### Shared Development Port Logic

Use one hub and many UIs:

```text
hubPort = env.IINPUBLIC_HUB_PORT || 8080
techSupportWebPort = 3001
browserUserPort(n) = 3001 + n
nativeLocalPort(n, sameMachine) = firstFreePort(8088 + n)
hubGunUrl = http://<hub-host>:hubPort/gun
```

Rules:

- `3001` is reserved for TechSupport in shared development.
- Browser end users start at `3002`.
- All shared-development browser UI ports must use the same hub, `8080`.
- Native app instances start at `8088` and increment only on the same machine.
- If a native default port is occupied, the launcher should try `8089`, `8090`,
  etc. and pass the selected port to the app through `IINPUBLIC_LOCAL_PORT`.
- Remote devices must receive a LAN URL for the hub, for example
  `http://192.168.10.48:8080/gun`.

### Isolated E2E Port Logic

Use one hub per Playwright worker:

```text
workerIndex = TEST_PARALLEL_INDEX
offset = E2E_PORT_OFFSET || 0
webPort = 3001 + offset + workerIndex
gunPort = 8080 + offset + workerIndex
hubGunUrl = http://127.0.0.1:gunPort/gun
```

Rules:

- This mode is for test isolation only.
- A browser on `3002` maps to `8081` only in isolated E2E mode.
- Shared development must not accidentally use this mapping.

### Native App Port Logic

For desktop and mobile:

```text
localPort = env.IINPUBLIC_LOCAL_PORT || firstFreePort(8088)
hubGunUrl = env.IINPUBLIC_HUB_GUN_URL || https://www.iinpublic.com/gun
uiOrigin = http://127.0.0.1:localPort
gunOrigin = http://127.0.0.1:localPort/gun
```

Rules:

- The native frontend does not need a separate port; it is served by the
  embedded Node process.
- Multiple native apps on the same machine require distinct local ports and
  distinct app data directories.
- Multiple native apps on different machines may all use `8088`.
- The browser/WebView talks to its own local embedded node, never directly to
  the shared hub for app APIs.
- The embedded node peers to the shared hub for discovery/signaling.

## Implementation Notes

Current root Playwright E2E already implements the isolated worker mapping:
`3001+worker -> 8080+worker`.

The shared-development scenario list above requires an explicit shared-dev
mode or launch helper so browser ports `3002`, `3003`, etc. do not accidentally
derive `8081`, `8082`, etc. The safest implementation is to give the browser
bundle an explicit hub override in shared development instead of relying only
on port arithmetic.
