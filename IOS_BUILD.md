# iOS build preparation

## Current checkpoint (2026-11-26)

Node 26.13.1/npm 11.20.0 are installed at C:\Program Files\nodejs; the agent
shell needed that directory prepended to its process PATH. Capacitor core/ios/cli
8.6.3 match package-lock.json and installed modules. The native ios/ Xcode
project was successfully generated and synchronized on Windows. All 22 tests,
web build and bundle validation passed. CI now uses npm ci. Compilation still
requires macOS/Xcode and has not been confirmed. Earlier checkpoints below are
historical; the previous package-installation blocker is resolved.

Latest checkpoint: capacitor.config.json now specifies webDir and a provisional
development app ID; package.json pins Capacitor core/ios/cli to 8.0.0. See
MAC_HANDOFF.md for the current setup instructions. A manual simulator-build
workflow exists but has not run. Package registry access failed on this host;
installation, lockfile and native project generation remain pending. The older
checkpoint below describes the state before these configuration files existed.

This repository currently prepares web assets, not an installable iOS application.

Run `node tools/build-mobile.mjs` (or `npm run build:mobile`). Output is
`artifacts/mobile-web`, intentionally ignored by Git. Use this as Capacitor webDir
when the native project is initialized. Do not use the repository root as webDir.
The build copies an explicit allowlist and disables service-worker registration
in the generated bundle. Browser/PWA behavior is unchanged.

Current remaining network dependencies: Leaflet CDN, OpenStreetMap tiles,
municipal GIS and route services. This is not a fully offline bundle. Before
distribution, vendor Leaflet and required image assets with license attribution,
and verify network access from the actual WKWebView origin.

Native environment checkpoint:
- Node 24.22.3 available on this Windows host; npm is not on PATH.
- macOS/Xcode are required to build and sign iOS; no local Xcode found.
- Official Capacitor 8 environment documentation currently specifies Node 22+
  and Xcode 26+. Verify exact package versions and requirements at installation.
- No Capacitor dependencies installed, native project generated, bundle ID
  registered, signing identity selected or device paired yet.
- Do not claim background location/audio support from this web bundle.

Next on a configured Mac: install matching pinned @capacitor/core, @capacitor/cli
and @capacitor/ios versions; initialize with webDir artifacts/mobile-web; add iOS;
sync; open Xcode; configure signing and install on the test device. Then implement
C4/C5 background location/audio proof before progressing to production alerts.

References checked 2026-11-24:
- https://capacitorjs.com/docs/getting-started
- https://capacitorjs.com/docs/getting-started/environment-setup
- https://capacitorjs.com/docs/ios
