package co.uk.staticplay.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Foreground service that owns the Quartz engine process. Hosting the engine in a foreground
 * service keeps it alive when the app is backgrounded AND keeps the app process (and the engine
 * child it spawns) in a higher-priority cpuset — so on-device generation stays on the big cores
 * and fast. The actual spawn lives in [QuartzEngine]; this just gives it a durable home.
 */
class QuartzService : Service() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startInForeground()   // idempotent; also re-satisfies the startForegroundService() contract
        QuartzEngine.start(this)
        // NOT sticky: the OS must not recreate this service in the background (doing so re-runs
        // startForeground() from a backgrounded process → ForegroundServiceStartNotAllowedException).
        // QuartzForegroundStarter restarts us cleanly the next time the app is foregrounded.
        return START_NOT_STICKY
    }

    // Android 14+ gives a dataSync FGS a limited time budget; when it runs out the OS calls
    // onTimeout and we MUST stop, or it kills us with ForegroundServiceDidNotStopInTimeException.
    // Stop cleanly here — the starter brings the engine back on the next foreground.
    override fun onTimeout(startId: Int) { stopSelf() }

    // Android 15 (API 35) added the 2-arg overload; it is the one dispatched on API 35+.
    override fun onTimeout(startId: Int, fgsType: Int) { stopSelf() }

    override fun onDestroy() {
        QuartzEngine.stop()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /** Re-post the FGS notification to reflect whether the engine is loaded or unloaded. Safe from
     *  any thread: notify() (unlike startForeground) has no background-start restriction. */
    fun updateEngineNotification(paused: Boolean) {
        val text = if (paused) "Engine off to save battery — open Saient to resume"
                   else RUNNING_TEXT
        val nm = getSystemService(NotificationManager::class.java)
        runCatching { nm.notify(NOTIF_ID, buildNotification(text)) }
    }

    private fun buildNotification(text: String): Notification {
        val channelId = "quartz_engine"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            val ch = NotificationChannel(channelId, "Quartz engine", NotificationManager.IMPORTANCE_LOW)
            ch.setShowBadge(false)
            nm.createNotificationChannel(ch)
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Notification.Builder(this, channelId) else Notification.Builder(this)
        return builder
            .setContentTitle("Saient")
            .setContentText(text)
            .setSmallIcon(applicationInfo.icon)
            .setOngoing(true)
            .build()
    }

    private fun startInForeground() {
        val notif = buildNotification(RUNNING_TEXT)
        try {
            // specialUse (API 34+) hosts the on-device inference engine; it has no dataSync time cap.
            // Older devices get the untyped startForeground (the type is declared in the manifest).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(NOTIF_ID, notif)
            }
        } catch (e: Exception) {
            // Never crash if the system refuses the foreground start for any reason: stop cleanly and
            // let the next foreground bring us back.
            android.util.Log.w("QuartzService", "startForeground refused; stopping service", e)
            stopSelf()
        }
    }

    private companion object {
        const val NOTIF_ID = 1
        const val RUNNING_TEXT = "On-device AI engine running"
    }
}
