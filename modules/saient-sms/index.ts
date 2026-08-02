import SaientSmsModule from "./src/SaientSmsModule";

/** Send an SMS directly via SmsManager (requires SEND_SMS permission, requested by the caller). */
export async function sendSmsDirect(number: string, message: string): Promise<boolean> {
  return await SaientSmsModule.sendSms(number, message);
}
