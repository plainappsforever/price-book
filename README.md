# Price Book

Compare shelf prices after the deal and remember what you paid. Offline, no ads.

At the shelf, Price Book shows which pack is really cheaper after the deal, and it remembers what you paid so you can tell a usual price from a good one next time.

**Get it:** [App Store](https://plainapps.dfdsfdsfsdf.workers.dev/apps/price-book/) · [Google Play](https://plainapps.dfdsfdsfsdf.workers.dev/apps/price-book/) · [GitHub Releases](https://github.com/plainappsforever/price-book/releases) ·
[Obtainium](https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/plainappsforever/price-book)

**Status:** first store release pending.

## Our promise

**Free, no ads, no tracking, no accounts.** This app keeps your data on your phone. It has no analytics, no crash
reporter, no advertising SDK and no sign-in. The Android release build has no INTERNET permission at all. We will not sell this app or this project to a company
that changes any of this.

Why we write it down: in 2023 a popular open-source Android suite was sold to an ad-funded app company and its store
listings started saying "Contains ads"; its community had to fork it to keep a clean version. The source code of
Price Book is published under GPL-3.0, so if this promise were ever broken, anyone could continue the last
version that kept it.

## What it does

No account. No ads. No subscription. The app has no internet permission: it works fully offline and your prices stay on your phone.

Compare
Open the app and type the price and size of two to five products. The keypad is ready, there is no sign-up and no tutorial. You see the price per kilo, litre or piece, which product is cheaper and how much you save. Mixed units (grams and ounces, millilitres and fluid ounces) are converted exactly. A warning appears when something looks wrong, for example sizes that differ by a factor of ten or two different kinds of unit.

Real deals
Add a deal in two taps: 3 for 2, buy one get one free, second at half price, percent off, N for a price, coupon, spend and save, cashback, deposit. Prices can include tax, or tax is added at the till; you choose, with an optional rate. "Show the maths" lists every step, so you can check it against the receipt.

Price memory
Save a price from a Compare card in three taps, or add one from your Price Book. For each product you see the latest, lowest, usual and highest unit price, a gauge that shows how the latest price sits against your usual one, the store where you last saw it cheapest, a chart of the unit price over time, and a note when a pack got smaller, based on the pack sizes you saved (shrinkflation). Everything comes from your own records. Price Book does not know shop prices and does not look anything up.

Your data
Back up everything to one file and restore it from a file; the app shows what the file contains and asks once before it replaces anything. Export your prices as a CSV file for a spreadsheet. Backup and CSV files are plain, not encrypted: you choose where to keep them, and nothing leaves your phone unless you share a file yourself. Tested with a price book of 5,000 saved prices.

Settings
Currency, number format (1,234.56 or 1.234,56), units (metric, US or UK), the "per ..." unit for unit prices, tax, an optional key tick (vibration), light, dark or system appearance. Currency, number format, units and tax wording start from your phone's region.

Good to know
- The app is in English for now.
- "Last seen cheapest" and "usual price" are worked out from the prices you saved, not from live shop prices.
- Tax, deposit and deal rules differ by shop and country. Price Book calculates what you type; the till has the last word.
- Barcode scan finds the products you saved; there is no online product database. Receipt and shelf-tag scanning are not in this version.
- Your phone's own backup (Google or iCloud) may include the app's data if you turned that backup on.

## Privacy

- All data is stored locally (SQLite in the app's private storage). Nothing is uploaded.
- Files leave the phone only when you share or export them yourself.
- Privacy policy: https://plainapps.dfdsfdsfsdf.workers.dev/apps/price-book/privacy

## Build from source

The app identifier `com.tim.pricebook` is a placeholder: the identifier changes before the first store release.

You need: **Node.js 22 LTS** (the React Native version used here accepts `^20.19.4 || ^22.13.0 || ^24.3.0`), npm,
and git. The app is an [Expo](https://expo.dev) (SDK 57) / React Native app; the native `android/` and `ios/` folders
are generated from `app.config.ts` and are not in the repository.

```sh
git clone https://github.com/plainappsforever/price-book.git
cd price-book
npm ci
npm run verify          # typecheck + lint + all unit tests
```

### Android (Linux, macOS or Windows)

Needs JDK 17 and the Android SDK (Android Studio installs both; set `ANDROID_HOME`).

```sh
export APP_VARIANT=production
npx expo prebuild --platform android
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# APK: android/app/build/outputs/apk/release/ (signed with the debug key unless you configure your own key)
```

`APP_VARIANT` selects the app id and name (`development`, `preview`, `production`; see `app.config.ts`).
Builds made this way are signed with your key, not ours, so they cannot update an installed store version.

### iOS (macOS only)

Needs Xcode (26 or newer) and CocoaPods.

```sh
export APP_VARIANT=production
npx expo prebuild --platform ios
npx expo run:ios --configuration Release        # runs on the iOS Simulator
```

For a real iPhone, open `ios/*.xcworkspace` in Xcode, choose your own team under *Signing & Capabilities*
and change the bundle identifier. There is no sideloading store for iOS; the App Store build is ours.

## Verifying a release

Every GitHub release lists SHA-256 checksums (`SHA256SUMS.txt`) and the APKs are signed with one key per app.
Certificate SHA-256 fingerprint: `not yet published on Android`

## How this app was made

Price Book was written with substantial help from an AI coding assistant (Claude Code), directed, reviewed and
tested by the maintainer. We say this openly because some stores and users care about it.

## Licence

Copyright (C) 2026 Farija Retkoceri

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
License as published by the Free Software Foundation, version 3 (GPL-3.0-only). See [LICENSE](LICENSE).
Third-party components keep their own licences (see `LICENSES/` and the app's licences screen where present).
Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).
