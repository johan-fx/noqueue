# Better Auth UI — NoQueue integration

Settings, AccountSettings, AuthProvider, ErrorToaster and the plugin typing are
copied from the official `base-nova` registry at https://better-auth-ui.com/r/base-nova/.
Source retrieved 2026-09-19. MIT license retained in LICENSE.

UserProfile, ChangeEmail and ChangePassword are credential-only adaptations of
the registry components, retaining Better Auth UI mutation/session hooks and the
ShadCN composition. Their TanStack Form bindings were replaced by react-hook-form
and zod to follow the project convention. ProfileForm is the local shared binding.
No TanStack Form dependency is required. The installed core/react/locales versions
are pinned in package.json and pnpm-lock.yaml.

Deliberately no avatar upload, account deletion, social account linking, public
signup or email password recovery. No forced password change. Username is immutable.
The API allowlist remains authoritative, independent of visible UI components.

When updating registry source, retain RHF bindings, exactOptionalPropertyTypes fixes,
no-error-logging policy and restrictive server API allowlist; rerun staff E2E.
