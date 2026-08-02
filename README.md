# Saient

**Local-first mobile AI. Chat, image generation, and text-to-video — all
running entirely on your phone. No cloud, no API keys, nothing leaves
the device.**

Saient is an Android app (iOS in progress) that runs a full generative
AI stack on-device: an LLM for chat, Stable Diffusion for images, and
**Wan2.1 for text-to-video** — the headline feature. Verified running
end-to-end on a stock Samsung Galaxy S24, generating real video clips
from a text prompt using only the phone's own Vulkan GPU.

The inference engine behind the chat and image side of the app,
**Quartz**, is open source: [github.com/SaientAI/saient-quartz](https://github.com/SaientAI/saient-quartz).
This repository documents the mobile app itself.

---

## What it does

- **On-device text-to-video** — type a prompt, get a real video clip,
  generated locally by [Wan2.1 T2V 1.3B](https://github.com/Wan-Video/Wan2.1),
  quantized for mobile. No render farm, no cloud job queue — the
  diffusion transformer runs on your phone's GPU right now, in front
  of you.
- **On-device LLM chat** — a local language model streams responses
  over a loopback HTTP/SSE connection to a native inference engine
  running inside the app (same engine, same API contract as the
  Saient desktop app).
- **On-device image generation** — SDXL text-to-image at 1024×1024,
  running through the same local engine.
- **Agent tools** — the chat assistant can use contacts, calls, SMS,
  and web lookup on-device.
- **Paired desktop Studio** — optionally pair with a Saient desktop
  instance on your LAN for heavier generation jobs, with resumable
  job monitoring back on the phone.

## Mobile-first architecture

Two native binaries do the actual compute work, both supervised by a
foreground Android service so generation survives backgrounding and
stays scheduled on the phone's performance cores:

| Engine | Handles | Backend |
|---|---|---|
| **Quartz** ([open source](https://github.com/SaientAI/saient-quartz)) | LLM chat + SDXL images | CPU (NEON) or Vulkan |
| **Wan video engine** | Wan2.1 text-to-video | split CPU (text encoder + VAE) / Vulkan (diffusion transformer) |

Only one engine runs at a time — the app pauses chat before a video or
image job starts, and resumes it afterward. Video generation uses
disk-paged weight loading, VRAM caps, and VAE tiling to fit a
multi-gigabyte model pipeline into a phone's shared memory budget.
Models are downloaded on first use (not bundled in the app package)
and verified file-by-file with SHA-256 before being installed.

## Features

- Local text-to-video with Wan2.1 T2V 1.3B (416×240, 5–41 frames in
  4-frame steps, 8fps)
- Local LLM chat with streaming responses, first-run model guidance,
  Downloads-folder GGUF import, and persistent app-private chat history
- Local SDXL image generation at 1024×1024
- Resumable, integrity-checked model downloads with an offline fallback
  catalog
- Agent tools: contacts, calls, SMS, web lookup
- Camera and photo-picker input with a native image-quality gate
- Optional paired desktop Studio for heavier jobs, with a versioned QR
  pairing flow and secure-store bearer token

## Installation

Saient mobile is not yet published to an app store. To build and run
it yourself:

```bash
git clone <this repo's app source repository>
cd saient-mobile
npm ci
npx expo prebuild --platform android --no-install
npm run android
```

The app requires a native development build — **Expo Go is not
sufficient**, since it depends on custom native modules (the inference
engines, foreground service, and native device integrations).

A production release build with proper signing:

```bash
npm run android:signing:init   # once, to establish your upload key
npm run android:release
```

## Supported hardware

| | Status |
|---|---|
| Android, ARM64, Vulkan-capable GPU | ✅ Verified — developed and tested on a Samsung Galaxy S24 (SM-S921B), Android 16 |
| Android, no Vulkan / older GPU | ⚠️ Chat (CPU-only) works; video and image generation need Vulkan |
| iOS | 🚧 In progress — native code must be built and exercised on macOS with Xcode before an iOS release |

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

**What happens to my chat history / generated media?**
Stored locally on the device, in the app's private storage. Nothing is
uploaded unless you explicitly pair with and send a job to a desktop
Studio instance.

## License

The Saient mobile application itself is proprietary and closed-source;
this repository is documentation, not source code. The on-device
inference engine that powers its chat and image generation, **Quartz**,
is open source under the MIT license: see
[SaientAI/saient-quartz](https://github.com/SaientAI/saient-quartz).

## Contributing

This repository is documentation for the Saient mobile app, not its
source tree. Bug reports and feature requests for the app are welcome
as issues here. For engine-level contributions (inference, quantization,
backends), see the [Quartz repository](https://github.com/SaientAI/saient-quartz).
