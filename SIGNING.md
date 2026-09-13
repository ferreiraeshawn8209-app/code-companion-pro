# Signing your release APK for the Play Store

The Play Store only accepts **signed** builds. Debug APKs install on your own
phone but can't be uploaded. Signing is free and takes about 2 minutes.

## 1. Create your upload keystore (one time)

You need a Java JDK (Android Studio installs one; or install any JDK 17+):

```bash
keytool -genkeypair -v \
  -keystore upload-keystore.jks \
  -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

It will ask for two passwords (keystore + key) and your name/org details.

**Keep `upload-keystore.jks` and the passwords safe forever.** Losing them
means you can never update your app on the Play Store again (unless you enroll
in Play App Signing, which lets Google keep the real key — recommended).

## 2. Add the secrets to GitHub

```bash
base64 -w0 upload-keystore.jks   # macOS: base64 -i upload-keystore.jks | tr -d '\n'
```

Copy the output, then in your repo go to
**Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name                | Value                          |
| -------------------------- | ------------------------------ |
| `ANDROID_KEYSTORE_BASE64`  | the base64 output from above   |
| `ANDROID_KEYSTORE_PASSWORD`| your keystore password         |
| `ANDROID_KEY_ALIAS`        | `upload` (or what you chose)   |
| `ANDROID_KEY_PASSWORD`     | your key password              |

## 3. Get the signed APK

Every push to `main` (or a manual run from the **Actions** tab →
**android-apk**) now produces two artifacts:

- **app-debug-apk** — quick testing on your own phone
- **app-release-apk** — signed, ready to upload in the Play Console

If the secrets aren't set yet, the release steps are skipped and you still get
the debug APK.

## Play Store note

For brand-new apps Google requires an **App Bundle (.aab)** rather than an
APK. To build one, change the release step in
`.github/workflows/android-apk.yml` from:

```bash
./gradlew assembleRelease --no-daemon
```

to:

```bash
./gradlew bundleRelease --no-daemon
```

and upload `android/app/build/outputs/bundle/release/app-release.aab`
instead. The same keystore and secrets are used.
