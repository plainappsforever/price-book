import type { ConfigContext, ExpoConfig } from 'expo/config';

// One codebase, three installable variants that can sit side by side on a device.
// Select with APP_VARIANT (set by scripts/native.sh and eas.json).
const VARIANTS = {
  development: { name: 'Price Book Dev', id: 'com.tim.pricebook.dev', scheme: 'pricebook-dev' },
  preview: { name: 'Price Book Preview', id: 'com.tim.pricebook.preview', scheme: 'pricebook-preview' },
  production: { name: 'Price Book', id: 'com.tim.pricebook', scheme: 'pricebook' },
} as const;

type Variant = keyof typeof VARIANTS;

const variant = (process.env.APP_VARIANT ?? 'development') as Variant;
if (!(variant in VARIANTS)) {
  throw new Error(`Unknown APP_VARIANT "${variant}". Use development, preview or production.`);
}
const { name, id, scheme } = VARIANTS[variant];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name,
  slug: 'price-book',
  // v1.1 fix round (RELEASE_KIT section 2): versionName 1.1.0, Android versionCode MMmmpp = 10100, iOS build 1 of 1.1.0.
  version: '1.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme,
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: id,
    buildNumber: '1',
    icon: './assets/expo.icon',
    // RELEASE_KIT 1c item 10: no encryption of its own, no network code -> ITSAppUsesNonExemptEncryption = false.
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: id,
    versionCode: 10100,
    adaptiveIcon: {
      backgroundColor: '#1B78DD',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // D55 (REVIEW_V1 S4, like the sibling apps): the price database is not copied to Google's phone backup; the user keeps
    // their own backup file (Data screen). About and the privacy policy say so per platform.
    allowBackup: false,
    // A13 / D11: the app reads and writes only its own cache and uses the system file picker and share sheet, so it needs no
    // storage permission. The dev client's overlay permission is for development builds only. ACCESS_NETWORK_STATE comes from a library that can download files; this app never does. VIBRATE stays: the key tick (setting)
    // needs it. Library manifests re-add these during the merge, so they are blocked rather than just not requested.
    ...(variant === 'development'
      ? {}
      : {
          blockedPermissions: [
            'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.SYSTEM_ALERT_WINDOW',
            'android.permission.ACCESS_NETWORK_STATE',
            // V1.5 P1 (D65): the barcode camera never records sound.
            'android.permission.RECORD_AUDIO',
          ],
        }),
  },
  plugins: [
    // Release variants: remove development-client residue (1c item 11). First, so its mods run after everyone else's.
    ...(variant === 'development' ? [] : (['./plugins/without-dev-client-residue.js'] as const)),
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#1B78DD', image: './assets/images/splash-icon.png', imageWidth: 200 }],
    'expo-sqlite',
    // Share sheet for backup / CSV files (sending only: no receiving, no permissions).
    'expo-sharing',
    // V1.5 P1 (R9, D65): barcode scanning on the phone with CameraView. Camera only (no microphone, no RECORD_AUDIO); asked for
    // when the user taps "Allow camera" on the scan screen. The scanner itself stays on (ML Kit, model bundled).
    [
      'expo-camera',
      {
        cameraPermission: 'Price Book uses the camera only to read product barcodes, so it can find the products you saved. Nothing is recorded or sent.',
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    // ...but without Google's downloadable code scanner (launchScanner), which the app does not use (D65).
    './plugins/without-google-code-scanner.js',
    // Dev builds reopen the last Metro server directly, so Maestro can launch them unattended.
    ['expo-dev-client', { launchMode: 'most-recent' }],
    // Dev menu defaults are for development builds only (Release builds have no dev menu).
    ...(variant === 'development' ? (['./plugins/with-dev-menu-defaults.js'] as const) : []),
    // D25: no network in release builds. Development builds keep INTERNET to reach Metro.
    ...(variant === 'development' ? (['./plugins/with-dev-internet.js'] as const) : (['./plugins/with-no-internet.js'] as const)),
    // Xcode 27 / iOS 27 SDK: apps without the UIScene lifecycle trap at launch. SDK 57 opt-in (expo >= 57.0.23,
    // expo-build-properties >= 57.0.20); SDK 58+ has it by default, then remove this line. See docs/DECISIONS.md.
    ['expo-build-properties', { ios: { enableSceneSupport: true } }],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    appVariant: variant,
  },
});
