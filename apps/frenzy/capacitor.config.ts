import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.icarusgames.frenzy',
  appName: 'Four-Leg Frenzy',
  webDir: 'dist',
  backgroundColor: '#e8f4e4',
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false },
};

export default config;
