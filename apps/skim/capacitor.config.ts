import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.icarusgames.skim',
  appName: 'Skim',
  webDir: 'dist',
  backgroundColor: '#dff2fb',
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false },
};

export default config;
