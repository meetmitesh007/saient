package co.uk.staticplay.app

import android.content.Context
import android.util.Log
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Supervises the Quartz inference engine (our ARM build) as an on-device localhost
 * server. The engine ships as `libquartz.so` in jniLibs so Android extracts it to the app's
 * nativeLibraryDir (the one place an app may exec from); we spawn it bound to 127.0.0.1:18799,
 * the same OpenAI-compatible SSE API the JS client (lib/quartz.ts) streams from.
 *
 * A supervisor loop watches the model folders + the app-written `.active` marker, so a model
 * downloaded in-app starts automatically (no restart) and switching the active model restarts
 * the engine on the new one. Models live in the internal files dir (where expo-file-system
 * downloads land) and/or the external dir (adb-pushed).
 */
object QuartzEngine {
    private const val TAG = "QuartzEngine"
    private const val PORT = "18799"
    private const val POLL_MS = 4000L
    private val RETIRED_MODELS = setOf(
        "qwen2.5-0.5b-instruct-q4km.gguf",
        "qwen2.5-1.5b-instruct-q4km.gguf",
    )

    @Volatile private var proc: Process? = null
    @Volatile private var currentModel: String? = null
    @Volatile private var supervisor: Thread? = null
    @Volatile private var service: QuartzService? = null
    @Volatile private var pausedState: Boolean? = null // null = unknown → reconcile on first poll

    @Synchronized
    fun start(svc: QuartzService) {
        service = svc
        if (supervisor?.isAlive == true) return
        val app = svc.applicationContext
        supervisor = Thread({ superviseLoop(app) }, "quartz-supervisor").apply { isDaemon = true; start() }
    }

    private fun superviseLoop(ctx: Context) {
        val bin = File(ctx.applicationInfo.nativeLibraryDir, "libquartz.so")
        if (!bin.exists()) { Log.e(TAG, "engine binary missing at ${bin.path}"); return }
        val dirs = listOf(File(ctx.filesDir, "models"), File(ctx.getExternalFilesDir(null), "models"))
            .onEach { it.mkdirs() }
        val modelsDir = File(ctx.filesDir, "models")
        val marker = File(modelsDir, ".active")
        val pausedMarker = File(modelsDir, ".paused")
        removeRetiredModels(dirs, marker)
        pausedState = null // fresh supervisor: reconcile the notification on the first iteration

        while (!Thread.currentThread().isInterrupted) {
            try {
                // A `.paused` marker (written by the app's "Unload model" control) means the user
                // wants the engine off to save battery: kill the process so the model leaves RAM.
                val paused = pausedMarker.exists()
                if (paused != pausedState) {
                    pausedState = paused
                    service?.updateEngineNotification(paused)
                }
                if (paused) {
                    proc?.let {
                        if (it.isAlive) {
                            Log.i(TAG, "unloading engine (user paused to save battery)")
                            it.destroy(); runCatching { it.waitFor(3, TimeUnit.SECONDS) }
                        }
                    }
                    proc = null; currentModel = null
                } else {
                    val desired = pickModel(dirs, marker)
                    val alive = proc?.isAlive == true
                    when {
                        desired == null -> if (!alive) Log.i(TAG, "waiting for a model (none in ${dirs.joinToString { it.path }})")
                        !alive || currentModel != desired.path -> restart(bin, desired)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "supervisor error", e)
            }
            try { Thread.sleep(POLL_MS) } catch (e: InterruptedException) { return }
        }
    }

    /** Remove only the two catalog artifacts retired by the Qwen3 migration. */
    private fun removeRetiredModels(dirs: List<File>, marker: File) {
        val active = runCatching { marker.readText().trim() }.getOrNull()
        for (dir in dirs) {
            for (name in RETIRED_MODELS) {
                for (file in listOf(File(dir, name), File(dir, "$name.part"))) {
                    if (file.exists() && file.delete()) Log.i(TAG, "removed retired model ${file.name}")
                }
            }
        }
        if (active in RETIRED_MODELS && marker.delete()) Log.i(TAG, "cleared retired active model")
    }

    /** Active marker wins (app's choice); else the largest .gguf present. */
    private fun pickModel(dirs: List<File>, marker: File): File? {
        val ggufs = dirs.flatMap { d ->
            d.listFiles { f -> f.isFile && f.name.endsWith(".gguf") }?.toList() ?: emptyList()
        }
        if (ggufs.isEmpty()) return null
        if (marker.exists()) {
            val want = runCatching { marker.readText().trim() }.getOrNull()
            ggufs.firstOrNull { it.name == want }?.let { return it }
        }
        return ggufs.maxByOrNull { it.length() }
    }

    @Synchronized
    private fun restart(bin: File, model: File) {
        proc?.let { it.destroy(); runCatching { it.waitFor(3, TimeUnit.SECONDS) } } // free port 18799
        Log.i(TAG, "starting engine on ${model.name}")
        val pb = ProcessBuilder(bin.path, model.path, "--server", PORT).redirectErrorStream(true)
        pb.environment()["RAYON_NUM_THREADS"] = "6"
        pb.environment()["QUARTZ_NO_WARMUP"] = "1" // page lazily — full-resident warmup gets the app OOM-killed
        val p = pb.start()
        proc = p
        currentModel = model.path
        Thread({
            try {
                p.inputStream.bufferedReader().forEachLine { Log.i(TAG, it) }
            } catch (e: Exception) {
                // The stream closes when we destroy() the engine (unload / model switch). That read
                // throws InterruptedIOException; swallow it — an uncaught exception on this thread
                // would crash the whole app process.
                Log.i(TAG, "engine log stream closed")
            }
        }, "quartz-log").apply { isDaemon = true; start() }
    }

    @Synchronized
    fun stop() {
        supervisor?.interrupt(); supervisor = null
        proc?.destroy(); proc = null; currentModel = null
        service = null
    }
}
