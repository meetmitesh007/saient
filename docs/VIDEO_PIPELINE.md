# On-device video generation pipeline

How Saient mobile turns a text prompt into a video clip, entirely on the
phone, with no cloud call. Verified against the current source of
`modules/saient-diffusion/android/.../SaientDiffusionModule.kt`,
`plugins/quartz/QuartzEngine.kt`, `plugins/quartz/QuartzService.kt`, and
`engine/wan/*.json`, and against a live generation observed via `adb`
on a Samsung SM-S921B (S24) mid-run.

📹 **[End-to-end proof video](https://youtu.be/ZXc5hBgoro0)** — a full
generation recorded on the device with Wi-Fi and mobile data switched off.
There is no network path a cloud call could take.

## The two engines

Saient runs **two independent native binaries**, both supervised through
the "Quartz" branding but built from two different codebases:

| | `libquartz.so` | `libquartz-wan.so` |
|---|---|---|
| Codebase | This app's own Rust runtime (`~/projects/tinyq4`, being open-sourced as **Quartz**) | A pinned fork of [leejet/stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) (MIT, C++/ggml) |
| Handles | Chat LLM (GGUF) + SDXL still images | Wan2.1 text-to-video only |
| Runs as | Long-lived HTTP server on `127.0.0.1:18799` | One-shot CLI process per video, no server |
| Pinned via | This crate's own `Cargo.toml`/git history | `engine/wan/BACKEND_LOCK.json` (commit `e31a86c`, ggml commit `eced84c`) + `engine/wan/saient-progress.patch` |

Only one of the two ever runs at a time on-device — see the handoff
section below. This matters because both are memory-hungry native
processes on a phone with a shared, small RAM budget; running them
concurrently is not attempted.

## Model pack

Wan2.1 T2V 1.3B, quantized for mobile, pinned in
`engine/wan/MODEL_PACK_LOCK.json` as pack id `wan2.1-t2v-1.3b-q4-v1`
(4.73 GB total):

| File | Size | Purpose |
|---|---|---|
| `wan2.1_t2v_1.3B_Q4_K.gguf` | 816 MB | the diffusion transformer, Q4_K quantized |
| `umt5-xxl-encoder-Q4_K_M.gguf` | 3.66 GB | UMT5-XXL text encoder, Q4_K_M quantized |
| `wan_2.1_vae.safetensors` | 254 MB | video VAE, fp16 |

The lock file also records a **host smoke-test result** and a
**`samplerProfile`** — the sampler settings these weights are validated
against, so a future change that silently reverts them fails the
`npm run test:wan` contract check.

## Stage 1 — acquiring the model (download & install)

`downloadVideoModel()` in `SaientDiffusionModule.kt`:

1. Downloads each of the 3 files from `https://saient.co.uk/models/<pack-id>/<path>`
   (self-hosted on the "Saient Pi", nginx-fronted) into a staging directory
   `.download-<pack-id>`.
2. Every file download is **resumable**: an existing `.part` file is
   continued via an HTTP `Range: bytes=<offset>-` request; a server that
   doesn't honor the range (returns `200` instead of `206` on a
   non-zero offset) forces a restart of that file.
3. After each file completes, its SHA-256 is checked against the pinned
   hash in `MODEL_PACK_LOCK.json` before it's accepted. Wrong size or
   wrong hash → the partial is deleted and re-downloaded, up to 4 retry
   attempts per HTTP failure with linear backoff.
4. A `.verified-pack` marker file (containing the pack id) is written
   into the staging directory once all three files pass.
5. The staging directory is **atomically installed**: the currently
   installed pack (if any) is renamed aside as a backup, the staging
   directory is renamed into place, and the backup is only deleted
   after the rename succeeds. If the rename fails, the backup is
   restored — the app is never left with a half-installed model.
6. Storage headroom (128 MiB) is checked against remaining bytes
   *before* downloading starts, so a download doesn't run the device
   out of disk mid-transfer.

`inspectVideoPack()` re-validates size + the `.verified-pack` marker
every time the pack's active/ready status is queried — not just at
install time — so a partially-corrupted pack (e.g. user copied files
around) is caught before a generation attempt wastes battery on it.

## Stage 2 — the chat/video handoff

The chat engine (`libquartz.so`) and the video engine
(`libquartz-wan.so`) never run at once. Before a video (or SDXL image)
generation starts:

1. A `models/.paused` marker file is written.
2. `QuartzEngine` (the Kotlin supervisor for the chat engine, polling
   every ~4s) sees the marker on its next reconciliation and stops the
   chat server.
3. `SaientDiffusionModule.waitForChatEngineToStop()` sleeps one full
   poll interval (4.25s) to cover the case where the chat engine was
   still mid-startup, then polls `127.0.0.1:18799` up to 12 times
   (250ms apart, ~3s) waiting for the port to close.
4. If the port is still open after that, generation aborts with
   "Quartz could not unload the chat model before video generation."
   rather than trying to run both engines under memory pressure.
5. After generation (success, failure, or cancel) the marker is
   deleted only if *this* call is what set it — a `wasPaused` flag
   guards against clobbering a pause the user had already set
   independently in Settings.

## Stage 3 — spawning the video process

The video engine is invoked as a plain child process (not a server),
one process per generation, with explicit CLI args:

```
libquartz-wan.so --mode vid_gen
  --diffusion-model wan2.1_t2v_1.3B_Q4_K.gguf
  --vae wan_2.1_vae.safetensors
  --t5xxl umt5-xxl-encoder-Q4_K_M.gguf
  --prompt "<user prompt>"
  --negative-prompt "<Wan2.1 upstream negative prompt>[，<user negative>]"
  --cfg-scale <guidance> --sampling-method euler
  --steps <8-20> --width 416 --height 240
  --video-frames <5-41, step 4> --fps 8 --flow-shift 8.0
  --seed <0-2147483647> --threads 6 --diffusion-fa
  --backend te=cpu,vae=cpu,diffusion=vulkan0
  --params-backend disk
  --max-vram cpu=0.20,vulkan0=0.75
  --vae-tiling
  --output saient-wan-<timestamp>.webm
```

Key choices baked into these flags, and why:

- **Split backend** (`te=cpu,vae=cpu,diffusion=vulkan0`) — only the
  diffusion transformer (the actual per-step compute) runs on the
  phone's Vulkan GPU. The text encoder and VAE run on CPU. This keeps
  peak VRAM down to roughly what the transformer alone needs, at the
  cost of two comparatively cheap CPU passes (one text encode up
  front, one VAE decode at the end).
- **`--params-backend disk`** — weights are paged from disk rather than
  fully mmap-resident, trading some throughput for a much smaller
  peak memory footprint — necessary headroom on a phone shared with
  the OS and every other app.
- **`--max-vram cpu=0.20,vulkan0=0.75`** — hard caps, not just hints,
  on how much of each device's memory budget the engine is allowed to
  claim, so a runaway allocation can't take down the whole phone.
- **`--vae-tiling`** — decodes the VAE output in tiles instead of one
  large pass, another peak-memory reduction specific to the decode
  step.
- **416×240 / 5–41 frames (4-frame increments) / 8fps** — the
  mobile-tuned resolution and duration envelope; frame count is
  constrained to `4n+1` because that's Wan's temporal-VAE frame
  grouping, not an arbitrary UI limit.
- **`--threads 6`** — matches the `RAYON_NUM_THREADS=6` the chat
  engine is capped to elsewhere, tuned for the device's number of
  performance cores.

### Why these quality settings (and what they fixed)

![Wan2.1 quality before and after](wan-quality-before-after.png)

*Identical seed (12345), identical step count (8), identical prompt
("A realistic adult woman standing in a naturally lit modern kitchen…").
The only differences are the three settings named below.*


Three of the values above are not arbitrary — shipping the wrong ones
produced ghost-like, washed-out, malformed human subjects while
non-human subjects looked comparatively fine:

- **`--flow-shift 8.0`** — upstream Wan2.1 specifies `--sample_shift 8`
  (range 8–12) for T2V-1.3B. We shipped `3.0`, which left the
  flow-matching schedule too little time in the high-noise structural
  phase, so bodies never consolidated and came out translucent.
- **The negative prompt is never empty.** Wan2.1's own upstream
  `sample_neg_prompt` is always applied, with any user text appended to
  it. Most of its clauses target human anatomy specifically (extra
  fingers, poorly drawn hands and faces, deformed, disfigured, malformed
  limbs, fused fingers, three legs) plus 整体发灰 "overall gray" and
  过曝 "overexposed". Sending an empty string left all of that
  unopposed — which is precisely why people failed and foxes didn't.
- **UMT5-XXL at Q4_K_M, not Q2_K.** Q2_K destroyed the conditioning
  detail needed to hold a human identity, so subjects dissolved partway
  through a clip. This is the single largest contributor and the reason
  the pack grew from 2.93 GB to 4.73 GB.
- **Minimum 8 steps.** Below 8, Wan cannot resolve a person at all: 1
  step renders a flat colour field and 4 renders a translucent
  silhouette. The step ladder starts at 8 for that reason.

Live confirmation (read via `adb shell ps` / `dumpsys` on the S24 while
a generation was in flight, without touching the device): the process
runs exactly as described, is owned by the `QuartzService` foreground
service (`isForeground=true`, notification channel `quartz_engine`),
and Android reports it consuming real CPU — this is a genuine on-device
run, not a simulated/mocked result.

## Stage 4 — progress reporting

The upstream `stable-diffusion.cpp` CLI reports progress via `\r`
carriage-return updates meant for an interactive terminal — invisible
to Android's `BufferedReader`, which only surfaces text after a
complete line. `engine/wan/saient-progress.patch` adds a small
`sd_set_progress_callback` hook that instead prints a newline-delimited
marker:

```
SAIENT_WAN_PROGRESS completed=<step> total=<steps>
```

`generateVideo()` reads the child process's stdout line by line,
matches this pattern, and forwards it to JS as an `onVideoProgress`
event, which `app/(tabs)/video.tsx` renders as a percentage bar. The
last 120 log lines are kept in a ring buffer; on a non-zero exit code,
the handler prefers `[ERROR` lines, then a `GGML_ASSERT`/`failed` line,
then the last line — trying to surface the most diagnostic line rather
than just "process exited 137" to the user.

## Stage 5 — completion and output

On a clean exit, the module checks the output file actually exists and
is more than 1 KB (a truncated/empty file is treated as failure even if
the process returned 0), then returns a `file://` URI plus metadata
(elapsed seconds, steps, seed, resolution, frame count, fps) to JS.
`video.tsx` plays the result immediately with `expo-video`'s
`VideoView`, looped.

Cancellation (`cancelLocalVideo()`) calls `Process.destroy()`, waits up
to 2s, then `destroyForcibly()` if it hasn't exited — the same pattern
used for the chat engine and SDXL generation.

## Why a foreground service

`QuartzService` hosts *both* engines' process lifetimes (it starts
`QuartzEngine`, which itself launches whichever binary is currently
active). Two Android-specific problems it solves:

1. **Backgrounding** — without a foreground service, Android would
   throttle or kill the app's process (and the native child it spawned)
   soon after the user leaves the app, aborting a multi-minute
   generation.
2. **CPU scheduling priority** — a foreground service keeps the process
   in a higher-priority cpuset, which keeps generation on the phone's
   performance cores instead of being scheduled onto efficiency cores.

It deliberately returns `START_NOT_STICKY` and handles `onTimeout` by
stopping cleanly: Android 14+ imposes a time budget on `dataSync`-type
foreground services and will throw
`ForegroundServiceDidNotStopInTimeException` if the service doesn't
self-stop in time. `QuartzForegroundStarter` is what brings the service
back the next time the app is foregrounded — the service does not try
to resurrect itself from the background, which Android 14+ also
forbids (`ForegroundServiceStartNotAllowedException`).

## End-to-end summary

```
User types prompt, taps Generate
        │
        ▼
Wan pack installed & valid? ──no──▶ download+verify+install (Stage 1)
        │ yes
        ▼
Write .paused marker → wait for chat engine port to close (Stage 2)
        │
        ▼
Spawn libquartz-wan.so --mode vid_gen  (Stage 3, on Vulkan + CPU split)
        │
        ├─ stdout: SAIENT_WAN_PROGRESS lines → onVideoProgress → progress bar
        │
        ▼
Exit 0 + output file valid?
        │ yes                              │ no
        ▼                                  ▼
Return file:// URI + metadata      Surface last ERROR/ASSERT log line
        │
        ▼
Delete .paused marker (if we set it) → chat engine free to reload
        │
        ▼
video.tsx plays the result in a looping VideoView
```
