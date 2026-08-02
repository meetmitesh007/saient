import { NativeModule, requireNativeModule } from 'expo';

declare class SaientSmsModule extends NativeModule<{}> {
  sendSms(number: string, message: string): Promise<boolean>;
}

export default requireNativeModule<SaientSmsModule>('SaientSms');
