import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.icarusgames.tissue',
  appName: 'Tissue Rush',
  webDir: 'dist',
  backgroundColor: '#e8f4ff',
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false },
};

export default config;
