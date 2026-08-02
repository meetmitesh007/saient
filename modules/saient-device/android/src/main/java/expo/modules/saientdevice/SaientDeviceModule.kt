package expo.modules.saientdevice

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SaientDeviceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SaientDevice")

    AsyncFunction("getProfile") {
      val context = requireNotNull(appContext.reactContext) { "Android context is unavailable." }
      val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val memoryInfo = ActivityManager.MemoryInfo()
      activityManager.getMemoryInfo(memoryInfo)
      val bytesPerMegabyte = 1024.0 * 1024.0

      mapOf(
        "totalMemoryBytes" to memoryInfo.totalMem.toDouble(),
        "availableMemoryBytes" to memoryInfo.availMem.toDouble(),
        "appMemoryClassBytes" to activityManager.memoryClass * bytesPerMegabyte,
        "logicalCores" to Runtime.getRuntime().availableProcessors(),
        "architecture" to (Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"),
        "platform" to "Android ${Build.VERSION.RELEASE}",
      )
    }
  }
}
