# Calendar for Android

A Capacitor shell around the calendar at <https://calendar.guymichaely.com/> (`../capacitor.config.ts`). It loads the site, so it shares its Cloudflare Access sign-in and gets its updates without a new APK; the site's service worker opens it offline. Its native part adds notifications: when tasks can start and before events (Settings → Notifications, in the app only).

## Installing and updating

`.github/workflows/android.yml` builds the signed APK on pushes to `prototype2` that change native code (this folder, `capacitor.config.ts`, dependencies), or when run by hand, and publishes it as the `android` release: on the phone, download **Calendar.apk** from <https://github.com/GuyMichaely/calendar/releases/tag/android> and open it (allowing installs from the browser once). Each build's version code is the workflow run number, so a newer APK installs over the old one and keeps the app's data.

## Signing

Every APK must be signed with the same key, or Android won't update over the old one (you'd have to uninstall first, losing the app's local data). The key is a PKCS#12 file kept in the repository's Actions secrets: `ANDROID_KEYSTORE_BASE64` (the file, base64), `ANDROID_KEYSTORE_PASSWORD`, and `ANDROID_KEY_ALIAS` (`calendar`). The original is in the ignored `.local/android-signing/` of the checkout that made it; keep a copy somewhere safe.

## Building locally

With Android Studio (or a JDK 21 and the Android SDK): `./scripts/bun run android:sync`, then open `android/` in Android Studio, or `cd android && ./gradlew assembleDebug`.
