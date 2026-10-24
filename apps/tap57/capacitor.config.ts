import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.icarusgames.tap57',
  appName: 'Tap the 57',
  webDir: 'dist',
  backgroundColor: '#f7e9d2',
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false },
};

export default config;
