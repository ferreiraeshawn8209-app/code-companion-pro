# Build the Android APK in the cloud (no Android Studio needed)

This repo includes `codemagic.yaml`, so Codemagic can build an installable
APK for you in the cloud. Your computer never needs the Android SDK.

## One-time setup (about 5 minutes)

1. **Push this project to GitHub** (from the app, or `git push`).
2. Go to **codemagic.io** → "Sign up with GitHub". The workflow uses the
   macOS M2 machine covered by Codemagic's individual free-minute allowance;
   Linux builders require billing to be enabled.
3. Click **Add application** and pick this repository.
4. When asked for the build configuration, choose **codemagic.yaml**.

## Get your APK

1. In Codemagic, start the **"Android APK (debug)"** workflow.
2. Wait ~10–15 minutes for the first build (later builds are faster).
3. On the build page, download **app-debug.apk** from the artifacts
   (it can also be emailed to you — set your address in `codemagic.yaml`).
4. Copy the APK to your phone (USB, email, Google Drive…) and tap it.
   Allow "install from unknown sources" when Android asks.

## Updating the app

Every time you push changes to GitHub, start the workflow again and you'll
get a fresh APK with the latest version bundled in.

## Play Store (optional, later)

The **"Android release"** workflow builds a signed App Bundle (`.aab`).
Upload your keystore in Codemagic under Teams → Code signing identities,
reference it in `codemagic.yaml`, and the output can be uploaded straight
to the Play Console.

## Notes

- The APK is a **bundled offline build** (Option 2) — the whole app ships
  inside it, no internet connection required at runtime except for the
  app's own backend features.
- The debug APK is signed with a throwaway debug key. That's fine for
  installing on your own phone, but the Play Store requires the release
  workflow with your own keystore.
