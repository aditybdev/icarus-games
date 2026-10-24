import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.icarusgames.mallow',
  appName: 'Golden Mallow',
  webDir: 'dist',
  backgroundColor: '#141a2e',
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false },
};

export default config;
