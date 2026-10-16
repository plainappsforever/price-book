// V1.5 P1 (D65): keeps Google's code scanner (com.google.android.gms:play-services-code-scanner) out of the Android app.
// expo-camera ships it for `launchScanner()`, whose scanner module Google Play services downloads on first use
// (https://developers.google.com/ml-kit/vision/barcode-scanning/code-scanner). Price Book never calls launchScanner(): it scans
// with CameraView, which uses ML Kit barcode-scanning with the model bundled in the app (com.google.mlkit:barcode-scanning,
// offline from the first scan). Only that one dependency is excluded; the bundled scanner stays. Applied to every variant so
// the development build tests the same app. Idempotent: prebuild --no-clean keeps the old build.gradle.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// price-book: without-google-code-scanner';
const BLOCK = `
${MARKER}
configurations.configureEach {
    exclude group: 'com.google.android.gms', module: 'play-services-code-scanner'
}
`;

module.exports = function withoutGoogleCodeScanner(config) {
  return withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes(MARKER)) mod.modResults.contents += BLOCK;
    return mod;
  });
};
