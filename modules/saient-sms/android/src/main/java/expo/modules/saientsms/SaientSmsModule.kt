package expo.modules.saientsms

import android.telephony.SmsManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Sends an SMS directly via SmsManager so the agent stays in Saient (no hand-off to the Messages
// app) and actually sends. Requires the SEND_SMS permission, requested on the JS side first.
class SaientSmsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SaientSms")

    AsyncFunction("sendSms") { number: String, message: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val sms: SmsManager =
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
          context.getSystemService(SmsManager::class.java)
        } else {
          @Suppress("DEPRECATION")
          SmsManager.getDefault()
        }
      val parts = sms.divideMessage(message)
      if (parts.size > 1) {
        sms.sendMultipartTextMessage(number, null, parts, null, null)
      } else {
        sms.sendTextMessage(number, null, message, null, null)
      }
      true
    }
  }
}
