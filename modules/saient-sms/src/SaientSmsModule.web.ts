import { registerWebModule, NativeModule } from 'expo';

class SaientSmsModule extends NativeModule<{}> {}

export default registerWebModule(SaientSmsModule, 'SaientSmsModule');
