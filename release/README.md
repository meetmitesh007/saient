# Android release safety

`npm run android:release` is the only production release entry point.

It performs a clean dependency install, lint, TypeScript checks, the desktop URL
security tests, Expo Doctor, a high/critical dependency audit, and clean APK/AAB
builds with `NODE_ENV=production`. It then rejects Android's debug certificate,
verifies both signatures, and archives the APK, AAB, R8 mapping, native symbols,
and SHA-256 checksums under `release-artifacts/android/<version>-<versionCode>/`.

## Signing setup

For an app that has never been uploaded to Play, establish its first upload key
once:

```sh
npm run android:signing:init
```

This creates `release/credentials/saient-upload.jks` and its generated
credentials in `release/credentials/keystore.properties`. The whole directory
is gitignored and kept outside the generated `android/` directory so a clean
Expo prebuild cannot remove it. The initializer refuses to overwrite an
existing key.

Back up both files together in an encrypted offline location before uploading.
Do not copy the passwords into source control, chat, tickets, or build logs.

For CI, set all four secrets instead:
   `SAIENT_ANDROID_KEYSTORE_PATH`, `SAIENT_ANDROID_KEYSTORE_PASSWORD`,
   `SAIENT_ANDROID_KEY_ALIAS`, and `SAIENT_ANDROID_KEY_PASSWORD`.

Manual `android/keystore.properties` configuration remains supported for
compatibility, but it lives inside the generated native tree and is easier to
lose during prebuild.

The release Gradle task fails when neither source is complete. Debug signing is
available only for physical-device smoke tests by setting
`SAIENT_ALLOW_DEBUG_RELEASE=true` and invoking Gradle directly; the production
release script refuses to run with that escape hatch enabled.

The release script accepts `ANDROID_HOME`, `ANDROID_SDK_ROOT`, or
`android/local.properties`. If none is set, it can infer the SDK root from an
`adb` executable inside a normal `<sdk>/platform-tools/` installation.

Before every later store upload, increment `android.versionCode` in the Expo app
configuration. Once the first build is uploaded, keep using this upload key.
