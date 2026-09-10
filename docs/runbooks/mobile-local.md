# Run the Capacitor shells locally

## Quick path

```bash
pnpm install --frozen-lockfile
pnpm mobile:sync
pnpm --filter @noqueue/mobile native:open:ios
# or
pnpm --filter @noqueue/mobile native:open:android
```

`mobile:sync` builds `apps/web/dist`, verifies `index.html`, copies that exact artifact and updates native plugin dependencies. Use `cap copy` only when plugin/native dependencies did not change.

## Platform commands

```bash
pnpm mobile:ios
pnpm mobile:android
```

Android builds require JDK 21. Verify the active JDK before running or opening Android:

```bash
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
test "$("$JAVA_HOME/bin/java" -XshowSettings:properties -version 2>&1 | awk '/java.specification.version/ { print $3 }')" = "21"
(cd apps/mobile/android && ./gradlew --version)
```

The CI Android job repeats the Android-specific Capacitor sync, rejects tracked native-project drift, and compiles `assembleDebug` under Temurin 21. iOS sync/build verification remains a local macOS check because no macOS CI runner has been selected:

```bash
pnpm mobile:sync
xcodebuild \
  -project apps/mobile/ios/App/App.xcodeproj \
  -scheme App \
  -sdk iphonesimulator \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  build
```

The provisional bundle/application identifier is `com.noqueue.app`. Replace it once, before signing capabilities, push credentials, Universal Links or store records are created.

## Not yet configured

- APNs/FCM projects and credentials.
- iOS Associated Domains and Android intent verification.
- Store signing, listings and release tracks.
- Production `VITE_API_URL`.
