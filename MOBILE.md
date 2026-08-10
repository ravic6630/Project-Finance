# Sampada on iOS & Android

The mobile apps are the same React app you already have, wrapped in
[Capacitor](https://capacitorjs.com). One codebase, one deploy story: the web
bundle is compiled into the app, and it talks to the same API at
`https://sampada-j9hi.onrender.com`.

Native projects live in `web/android` and `web/ios` and **are committed** —
their build outputs are not.

---

## Build commands

```bash
npm run mobile:sync              # build the web app + copy it into both native projects
npm run mobile:android           # sync + build a debug APK
npm run mobile:android:release   # sync + build the .aab for Play Store
npm run mobile:ios               # sync + open the project in Xcode
```

Android builds need these two exports (JDK 21, which Capacitor 8 requires):

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
```

The debug APK lands at
`web/android/app/build/outputs/apk/debug/app-debug.apk` — you can email that to
your phone and install it directly (enable "install unknown apps").

---

## What's already done

- **Bundle id / name**: `app.sampada.wealth`, "Sampada".
- **Icons + splash**: generated from `web/assets/logo.png` for every size both
  stores need. Re-run after changing the logo:
  `cd web && npx @capacitor/assets generate --iconBackgroundColor '#0d1626' --splashBackgroundColor '#0d1626'`
  (the current logo was upscaled from a 512px PNG — export a crisp 1024px
  version into `web/assets/logo.png` before you submit).
- **Permissions requested**: internet, vibrate, network state, biometrics. That's
  all — nothing that triggers extra store review.
- **App lock**: Face ID / Touch ID / fingerprint, off by default, switched on in
  Settings. Re-locks after a minute in the background.
- **Native touches**: haptics, the share sheet for your referral link, OS status
  bar that follows dark mode, safe-area padding for the notch, an offline
  banner, and Android's hardware back button wired to in-app history.
- **Broker connect**: first-time OAuth still happens on the website (the broker
  redirects to the web origin, which the app shell can't authenticate). Once
  linked, **Sync now** works fine in the app — which is the daily action anyway.

---

## ⚠️ Before you submit: in-app purchases

Apple (guideline 3.1.1) and Google both require **their own billing** for digital
subscriptions, and take 15–30%. Selling Premium through UPI or Zelle inside the
app would get it rejected.

So the native builds ship with **no purchase path at all**: the upgrade screen
explains what Premium includes and that plans are managed on the account. Anyone
who is already Premium gets every feature in the app. This is the same pattern
Netflix and Spotify use, and it passes review.

When you want to sell inside the apps, add StoreKit / Play Billing and flip
`canPurchaseInApp` in `web/src/lib/native.js`.

---

## Publishing checklist

### Android — Play Store (~$25 one-time)

1. Create a [Play Console](https://play.google.com/console) account.
2. Generate an upload key and put its details in `web/android/keystore.properties`
   (never commit it):
   ```bash
   keytool -genkey -v -keystore sampada-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias sampada
   ```
3. `npm run mobile:android:release` → upload
   `web/android/app/build/outputs/bundle/release/app-release.aab`.
4. Fill in: store listing, a privacy policy URL (**required** — finance apps are
   checked), the Data Safety form, and a content rating questionnaire.
5. Start with internal testing, then production.

### iOS — App Store ($99/year)

1. **Install Xcode** from the Mac App Store (~7 GB), then:
   `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
2. Join the [Apple Developer Program](https://developer.apple.com/programs/).
3. `npm run mobile:ios` → in Xcode set your Team under Signing & Capabilities,
   then Product → Archive → Distribute.
4. `NSFaceIDUsageDescription` is already in `Info.plist` (required, or the app
   crashes on Face ID).
5. Fill in App Privacy answers and submit for review.

Both stores need a privacy policy URL. The app collects an email, financial data
the user enters, and (optionally) broker holdings — say exactly that.

---

## Updating the apps

Any change to the web app reaches phones only through a new store build:

```bash
npm run mobile:sync   # then rebuild/upload
```

Bump `versionCode`/`versionName` in `web/android/app/build.gradle` and the
version in Xcode for each release.
