// Capacitor configuration for packaging SHAYON FIRE MAX as an Android APK
// Run: npm install @capacitor/core @capacitor/cli @capacitor/android
// Then: npm run build && npx cap add android && npx cap sync android && npx cap open android

const config = {
  appId: 'com.shayonstudio.firemax',
  appName: 'SHAYON FIRE MAX',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
