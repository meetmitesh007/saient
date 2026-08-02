# Saient Mobile

**Local-first mobile AI. Chat, image generation, and text-to-video — all
running entirely on your phone. No cloud, no API keys, nothing leaves
the device.**

Saient is a local-first mobile AI app. The app owns and ships the Quartz ARM64
runtime; language models are downloaded separately into the app's private
storage and are not baked into the application package.

**Headline capability:** on-device text-to-video with
[Wan2.1 T2V 1.3B](https://github.com/Wan-Video/Wan2.1) — verified
running end-to-end on a stock Samsung Galaxy S24's Vulkan GPU. See
[docs/VIDEO_PIPELINE.md](docs/VIDEO_PIPELINE.md) for exactly how
prompt → video happens on-device, backend split, memory budget, and all.

The LLM/SDXL inference engine this app ships, **Quartz**, is developed
in its own open-source repo:
[SaientAI/saient-quartz](https://github.com/SaientAI/saient-quartz) (MIT).

## Current features

- On-device chat through Quartz's localhost HTTP/SSE API
- First-run model guidance, Downloads-folder GGUF imports, device-aware model sizing, and reloadable app-private chat history
- Downloadable model catalog with an offline fallback
- Agent tools for contacts, calls, SMS, and web lookup
- A paired Studio for desktop image generation and WAN image-to-video
- Camera and system-photo-picker input with a native image quality gate
- Resumable desktop render monitoring and local generated-media storage
- Direct, resumable SDXL FP16 download from Saient's self-hosted Raspberry Pi,
  followed by per-file SHA-256 checks and Quartz validation before atomic install
- On-device 1024×1024 image generation through Quartz-owned model parsing,
  tokenization, scheduling, operators, memory management, and Vulkan dispatch

Studio pairing uses a versioned QR payload and stores its bearer token in the
platform secure store. Plain HTTP desktop addresses are accepted only for
loopback, private LAN, link-local, `.local`, or `localhost` hosts; public hosts
must use HTTPS. Private-LAN HTTP traffic is still unencrypted on the network,
so use only a trusted LAN until the desktop transport supports TLS.

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
- `lib/desktop.ts` — paired desktop generation client and job persistence
- `plugins/` — durable Expo prebuild configuration
- `modules/` — Saient native Android/iOS modules
- `engine/arm64-v8a/` — Saient's bundled Quartz ARM64 runtime
- `docs/` — architecture write-ups (video pipeline)

## Supported hardware

| | Status |
|---|---|
| Android, ARM64, Vulkan-capable GPU | Verified — developed and tested on a Samsung Galaxy S24 (SM-S921B), Android 16 |
| Android, no Vulkan / older GPU | Chat (CPU-only) works; video and SDXL image generation need Vulkan |
| iOS | In progress — native code must be built and exercised on macOS with Xcode before an iOS release (see `ios/`) |

## Requirements

- An Android device with a Vulkan-capable GPU for on-device video/image
  generation (chat works on CPU-only devices)
- ~8GB+ RAM recommended (the target device class this was built for)
- Free storage: roughly 3GB for the Wan2.1 video pack, plus space for
  whatever LLM/SDXL models you download separately
- Internet access for the initial model download only — generation
  itself is fully offline afterward

## Roadmap

- [ ] iOS release
- [ ] Play Store listing
- [ ] Larger/higher-resolution Wan video presets, hardware permitting
- [ ] Encrypted transport for desktop Studio pairing (currently
      unencrypted on private LAN)
- [ ] Expanded agent tool set

## Screenshots

_Coming soon — placeholder while we capture clean device screenshots._

## FAQ

**Is generation actually happening on my phone, or is this a cloud API
behind a mobile UI?**
On-device. The video/image/chat engines are native binaries that run
as a child process on your phone and are visible as such (foreground
service, real CPU/GPU load). There is no server call in the generation
path — only the initial one-time model download talks to the network.

**Why does video generation take a while?**
A 1.3B-parameter video diffusion model is genuinely heavy for a phone.
Expect it to take minutes, not seconds, and expect the phone to get
warm. Start with the shortest/fewest-step preset before trying longer
clips.

**Do I need an account or API key?**
No. There's no login and no API key for on-device generation.

**Does it work without internet?**
Yes, once models are downloaded. The initial download needs a
connection; generation itself does not.

## License

MIT — see [`LICENSE`](LICENSE). The on-device inference engine this
app embeds, Quartz, is separately MIT-licensed in its own repo:
[SaientAI/saient-quartz](https://github.com/SaientAI/saient-quartz).

## Contributing

Issues and PRs welcome. For engine-level work (inference, quantization,
backends), see the [Quartz repository](https://github.com/SaientAI/saient-quartz)
instead — this repo is the mobile app that consumes it.
