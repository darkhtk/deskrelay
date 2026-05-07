// Capacitor config for the Android (and later iOS) wrapper.
//
// appId is permanent in Play Console — chosen with the user 2026-04-28
// and matches what we registered there. appName is the on-device label.
// webDir is the static bundle location populated by `bun run build:web`,
// which copies packages/site-frontend/dist into ./dist.
//
// `androidScheme: "https"` makes the WebView serve the bundled assets
// from `https://localhost` (Capacitor 6 default), which avoids mixed-
// content downgrades when the page calls our HTTPS site backend.
//
// `cleartext` is intentionally NOT set here — production builds must
// talk to HTTPS only. For dev against a LAN site backend (`http://
// 192.168.x.x:18092`), pass `--server.cleartext` at build time or use
// `npx cap run android --target emulator` with the dev server URL.

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.github.darkhtk.deskrelay",
  appName: "DeskRelay",
  webDir: "dist",
  android: {
    // Adaptive icon + splash background tint; Android Studio fills in
    // the actual icon resources after `cap add android` scaffolds res/.
    backgroundColor: "#0b0b0e",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: "#0b0b0e",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0b0b0e",
    },
  },
};

export default config;
