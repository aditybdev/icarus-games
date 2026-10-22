import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.icarusgames.fold',
  appName: 'Fold',
  webDir: 'dist',
  backgroundColor: '#f5f1e8',
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false },
};

export default config;
