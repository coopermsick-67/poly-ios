# Signal Slate for iOS

Signal Slate tracks Polymarket's all-time sports leaderboard, scores up to 1,000 wallets, and publishes a daily top-three consensus snapshot. It is a read-only research app: it does not connect a wallet, execute trades, or guarantee outcomes.

## What it includes

- A native SwiftUI iPhone and iPad app with a daily picks board, trader search and profiles, open sports positions, sampled settled results, and a visible scoring explanation.
- A React Native Expo version in `expo/` that uses the same public feed and can be previewed in Expo Go without a Mac.
- A Node.js snapshot job using Polymarket's public Data API and Gamma sports catalog. It pages the all-time `SPORTS` leaderboard, reads open positions and up to 100 recent closed positions per wallet, estimates sampled win rate, and writes `docs/daily-picks.json`.
- A GitHub Actions workflow that refreshes that JSON every day at 13:15 UTC and supports manual runs.
- A separate GitHub Actions workflow and Fastlane lane that build and upload an iOS archive to TestFlight.

The trader score is 40% PnL rank, 30% recent settled win rate with a neutral four-result prior, 15% sports volume rank, and 15% open-position rank. Daily picks require at least two tracked wallets and 55% score-weighted support. Each profile's win rate is based on the returned sample, not lifetime performance. Wallet scores are shown on a 0.0–100.0 scale to one decimal place and are relative to the imported comparison cohort, so scores from different lists are not directly comparable.

## Run the daily feed

1. Put this repository on GitHub. The snapshot feed must be public for the default unauthenticated iOS feed URL (`raw.githubusercontent.com`).
2. In repository **Settings → Actions → General**, allow workflows to read and write repository contents.
3. Run **Actions → Build daily sports snapshot → Run workflow** once. The scheduled job then refreshes it at 13:15 UTC daily.
4. The job writes the snapshot to `docs/daily-picks.json`; the iOS TestFlight lane embeds that repository's raw JSON URL into the app.

The generation job uses public endpoints only and needs no Polymarket credentials. It makes two data requests for each of up to 1,000 wallets, with bounded concurrency and retries. Public API availability and rate limits can delay a snapshot; the app shows the last saved snapshot if a refresh fails.

## Build locally in Xcode

Open `PolymarketEdge.xcodeproj` in Xcode 15 or newer, choose the `PolymarketEdge` scheme and an iOS 17 or newer simulator, then run. The checked-in bundle identifier is a placeholder. For a device build, change `com.yourcompany.PolymarketEdge` to a reverse-DNS identifier registered to your Apple Developer team. In the app, use the settings button to enter a public `daily-picks.json` URL if you are not using the included GitHub workflow. In the native iOS Traders tab, use **Import TXT & scan up to 2,000 wallets** to open the companion scanner.

## Preview in Expo Go without a Mac

The second implementation is in [`expo/`](expo/README.md). The quickest path is to open `expo/App.js` in a browser, add `expo-document-picker` and `expo-file-system` to a new Snack at [snack.expo.dev](https://snack.expo.dev), choose iOS, then scan Snack's QR code with Expo Go. Expo Go is free and this version does not need a custom native build. The Expo app also imports and analyzes a TXT list of up to 2,000 wallet addresses on-device. A Windows or Linux computer can run it with `cd expo && npm install && npx expo start --tunnel`.

## Upload to TestFlight

1. Enroll in the Apple Developer Program, register the bundle identifier, and create its matching app record in App Store Connect.
2. Create a team App Store Connect API key with access to the app record and signing profiles. Keep the downloaded `.p8` private.
3. Add these GitHub Actions repository secrets:

   - `APP_STORE_CONNECT_KEY_ID`
   - `APP_STORE_CONNECT_ISSUER_ID`
   - `APP_STORE_CONNECT_KEY_P8_BASE64` — base64 encode the `.p8` contents (on macOS: `base64 < AuthKey_XXXXXXXXXX.p8 | tr -d '\n'`)
   - `APPLE_TEAM_ID`
   - `IOS_BUNDLE_IDENTIFIER` — the registered identifier from step 1

4. Run the daily snapshot workflow once, then run **Actions → Upload iOS build to TestFlight → Run workflow** on the branch containing this project.
5. Xcode signs the app with automatic signing and the API key, then Fastlane uploads the IPA. After Apple processes the build, add it to an internal TestFlight group in App Store Connect.

The repository includes a shared Xcode scheme and an app icon. Uploading requires your own Apple Developer team and App Store Connect credentials; those cannot be created from this workspace.

## Data and timing

The scheduled snapshot is generated for the current calendar date in `America/New_York`. Picks match tracked positions to active sports markets scheduled later that day in Polymarket's Gamma event feed. They represent consensus in the sampled public positions when the job runs; market prices and wallet positions may change afterward. A day with fewer than three qualified markets can show fewer than three picks.
