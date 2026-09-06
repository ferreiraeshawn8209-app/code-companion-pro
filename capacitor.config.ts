import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration for spok — native Android + iOS shells.
 *
 * OPTION 2 — bundled offline build (Play Store ready).
 * The web build in `dist/` is copied into the native project, so the app runs
 * without a network round-trip and can be submitted to the stores.
 *
 * Ship a new version:
 *   1. bun run build
 *   2. bun run cap:sync:android
 *   3. Android Studio -> Build -> Generate Signed Bundle / APK
 *
 * (To go back to live-reload, re-add a `server: { url: "https://spokcodeagent.lovable.app" }` block.)
 */
const config: CapacitorConfig = {
  appId: "green.codex.spok",
  appName: "spok",
  webDir: "dist/client",
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: "#000000",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
  },
};

export default config;
