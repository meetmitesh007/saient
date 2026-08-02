package co.uk.staticplay.app

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log

/**
 * Starts the Quartz foreground service ONLY while the app has a visible (started) activity.
 *
 * Why this exists: the old build called startForegroundService() straight from
 * Application.onCreate. When Android recreates the app process in the background (memory kill,
 * provider access, alarm, etc.) that call runs with the app in the background, which Android 12+
 * forbids — it throws ForegroundServiceStartNotAllowedException and the whole app crashes. That
 * is the "Saient crashed" warning Samsung shows while the app is backgrounded.
 *
 * Registering lifecycle callbacks is always allowed. Starting the FGS from the first *started*
 * activity means we only ever start it while the app is foreground, where it is always permitted.
 * A service started from the foreground may legally keep running once the app is backgrounded, so
 * the engine stays warm; QuartzService is START_NOT_STICKY + handles onTimeout so the OS never
 * resurrects or crashes it in the background.
 */
class QuartzForegroundStarter : Application.ActivityLifecycleCallbacks {
    private var startedActivities = 0

    override fun onActivityStarted(activity: Activity) {
        if (startedActivities++ == 0) {
            try {
                val intent = Intent(activity, QuartzService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) activity.startForegroundService(intent)
                else activity.startService(intent)
            } catch (e: Exception) {
                // Never let engine startup take the app down. Worst case the engine stays down
                // until the next foreground; the chat UI degrades gracefully to its offline notice.
                Log.w("QuartzForegroundStarter", "could not start Quartz service", e)
            }
        }
    }

    override fun onActivityStopped(activity: Activity) {
        if (startedActivities > 0) startedActivities--
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivityResumed(activity: Activity) {}
    override fun onActivityPaused(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {}
}
