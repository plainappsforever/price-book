# Shared toolchain paths and defaults for project scripts. Source this file; don't run it.
export LANG="${LANG:-en_US.UTF-8}" # CocoaPods requires UTF-8
# Dev builds reach Metro via localhost (Android uses adb reverse); LAN IPs get blocked by firewalls.
export REACT_NATIVE_PACKAGER_HOSTNAME=localhost
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$HOME/.maestro/bin:/opt/homebrew/bin:$PATH"

# Default targets. Override per command, e.g. IOS_SIMULATOR="iPhone 17" npm run ios
# V1.5 P1 (2026-10-14): stay on the iOS 26.5 runtime ("PriceBook iPhone"). Xcode 27 apps without UIScene adoption trap at launch on
# the iOS 27 runtime until the template's Expo patch sweep (expo-build-properties ios.enableSceneSupport, orchestrator). "PriceBook
# iPhone 27" (iOS 27.0) and "PriceBook iPhone 26" (iOS 26.5, spare) were created in V1.5 P1 and are not used by default.
export IOS_SIMULATOR="${IOS_SIMULATOR:-PriceBook iPhone}"
# iOS runtime of that simulator. Empty = newest installed (27.0 with Xcode 27). Older one: IOS_RUNTIME=26.5 npm run ios
# boot.sh (scripts/ios-simulator.js) creates IOS_SIMULATOR on the chosen runtime if it does not exist there yet.
export IOS_RUNTIME="${IOS_RUNTIME:-}"
export ANDROID_AVD="${ANDROID_AVD:-PriceBook_API_36}"
# Dedicated ports so other apps can build in parallel (D21).
export METRO_PORT="${METRO_PORT:-8102}"
export ANDROID_EMULATOR_PORT="${ANDROID_EMULATOR_PORT:-5602}"

# macOS 27 + Xcode 26: CocoaPods (pod install in `expo prebuild`) picks the Command Line Tools macOS SDK 27,
# whose libSystem.B.tbd fails with "malformed file". Pin the Xcode-shipped SDK (as in mobile-starter). native.sh unsets
# it after prebuild because it must not leak into xcodebuild (it would override the iOS SDK).
if [[ -z "${SDKROOT:-}" ]] && _sdk=$(xcrun --sdk macosx --show-sdk-path 2>/dev/null) && [[ -n $_sdk ]]; then
  export SDKROOT="$_sdk"
fi
unset _sdk
