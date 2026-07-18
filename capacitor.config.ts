import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration for spok — native Android + iOS shells.
 *
 * The web build is emitted to `dist/` by Vite (webDir). For fast iteration on
 * a physical device, flip `server.url` to your dev server (e.g. the LAN IP
 * printed by `vite dev`, or the published Lovable URL) and rebuild the native
 * project with `bunx cap sync`.
 *
 * Live reload against the published preview:
 *   1. bun run build
 *   2. bunx cap sync
 *   3. bunx cap run android   # or: bunx cap run ios
 */
const config: CapacitorConfig = {
  appId: "green.codex.spok",
  appName: "spok",
  webDir: "dist",
  bundledWebRuntime: false,
  server: {
    // Point at the deployed web app so the shell hot-loads UI changes without a rebuild.
    url: "https://spokcodeagent.lovable.app",
    cleartext: true,
    androidScheme: "https",
  },
  android: {
    allowMixedContent: true,
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
