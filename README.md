# Saient Mobile

Saient is a local-first mobile AI app. The app owns and ships the Quartz ARM64
runtime; language models are downloaded separately into the app's private
storage and are not baked into the application package.

**On-device text-to-video with [Wan2.1 T2V 1.3B](https://github.com/Wan-Video/Wan2.1)**,
running on the phone's own Vulkan GPU.
📹 **[End-to-end proof video](https://youtu.be/ZXc5hBgoro0)** — a full generation
recorded on the device with Wi-Fi and mobile data switched off, so there is no
network path a cloud call could take.

## Current features

- On-device chat through Quartz's localhost HTTP/SSE API
- First-run model guidance, Downloads-folder GGUF imports, device-aware model sizing, and reloadable app-private chat history
- Downloadable model catalog with an offline fallback
- Agent tools for contacts, calls, SMS, and web lookup
- Camera and system-photo-picker input with a native image quality gate
- Local generated-media storage
- Direct, resumable SDXL FP16 download from Saient's self-hosted Raspberry Pi,
  followed by per-file SHA-256 checks and Quartz validation before atomic install
- On-device 1024×1024 image generation through Quartz-owned model parsing,
  tokenization, scheduling, operators, memory management, and Vulkan dispatch

All generation runs on the device. The app makes no inference calls to any
server; the only network access is the one-time model download from
`saient.co.uk` and optional agent web lookups the user explicitly triggers.

## Development

The app contains custom native modules and requires a native development build;
Expo Go is not sufficient.

```bash
npm ci
npx expo prebuild --platform android --no-install
npm run android
```

Useful checks:

```bash
npm run lint
npm run typecheck
npm run test:security
npm run doctor
```

The current release is exercised on a physical ARM64 Samsung SM-S921B running
Android 16. iOS native code must be compiled and exercised on macOS with
Xcode before an iOS release.

## Production release

Run `npm run android:signing:init` once to establish the Android upload key,
then run `npm run android:release`. The release command fails closed without
production signing credentials,
rejects Android's debug certificate, runs the project checks, and archives the
APK, AAB, R8 mapping, native symbols, and SHA-256 checksums.

See [release/README.md](release/README.md) for signing and release details.

See [docs/VIDEO_PIPELINE.md](docs/VIDEO_PIPELINE.md) for how on-device
Wan2.1 video generation works end to end.

## Layout

- `app/` — Expo Router screens
- `lib/quartz.ts` — on-device Quartz streaming client
- `lib/models.ts` — model catalog, downloads, and active-model state
- `plugins/` — durable Expo prebuild configuration
- `modules/` — Saient native Android/iOS modules
- `engine/arm64-v8a/` — Saient's bundled Quartz ARM64 runtime
