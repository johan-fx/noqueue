# Install the local prerequisites

## Required

| Tool | Minimum | Verify |
| --- | --- | --- |
| Node.js | 22.19 | `node --version` |
| pnpm | 10.23 | `pnpm --version` |
| Git | Current supported release | `git --version` |

Use Corepack or the team's Node version manager to install pnpm. The root `packageManager` field pins the expected pnpm release.

## Native development

- iOS requires macOS, Xcode and accepted Xcode command-line licenses.
- Capacitor Android requires JDK 21, Android Studio, an installed SDK and a configured emulator/device.
- Real push notifications additionally require Apple/Google project credentials; these are not part of the bootstrap.

On macOS, select and verify JDK 21 before invoking Gradle:

```bash
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
"$JAVA_HOME/bin/java" -version
cd apps/mobile/android
./gradlew --version
```

Both version commands must report Java/JVM 21. In CI, `actions/setup-java` selects Temurin 21 explicitly.
