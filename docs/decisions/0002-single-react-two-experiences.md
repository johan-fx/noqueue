# ADR 0002: Use one React build with two experience compositions

**Status:** Accepted

## Decision

Maintain one Vite/React application. Select separate web and native shells and route trees at the composition root. Capacitor packages `apps/web/dist` rather than hosting a second React application.

## Consequences

- shadcn components, styles, localization and shared features have one owner.
- Platform integrations stay behind `platform/browser` and `platform/capacitor` boundaries.
- A second React build is reconsidered only if navigation, release cadence or most screens diverge materially.
