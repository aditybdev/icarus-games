import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.icarusgames.swirl',
  appName: 'Swirl!',
  webDir: 'dist',
  backgroundColor: '#fff0f5',
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false },
};

export default config;
