# Administration redesign — design QA

## Evidence and state

- Source: Figma `Y4yqqmDdJ0q1VAgA8EQsi6`, nodes `1557:9142`, `1557:10627`, `1557:10651`, `1557:10672`, `1557:10727`.
- Source visual truth: `/private/tmp/noqueue-figma-review/01-establishments.png` (1504 × 848 pixels). Active-card source: `/private/tmp/noqueue-figma-review/04-active-card.png` (622 × 212 pixels, including export padding).
- Final browser screenshot: `/private/tmp/noqueue-figma-review/implementation-final-desktop.jpg` (1366 × 771 pixels).
- Full-view combined comparison: `/private/tmp/noqueue-figma-review/comparison-after.png`.
- Focused combined comparison: `/private/tmp/noqueue-figma-review/comparison-card-after.png` (active card, typography, badge, service icon, divider, footer and action).
- Local preview: `http://127.0.0.1:5178/node_modules/.cache/admin-preview/index.html?page=1`. An ignored fixture harness imports the real StaffApp/Commercial components and mocks fetch. It does not prove production authentication or a live browser-to-API integration.
- State: light theme, Establishments selected, Todos, blank search, four reference establishments, no overlay or input focus. Actual configuration dates replace reference-relative dates.

### Viewport and normalization

Desktop override 1654 × 933 produced a measured CSS viewport of 1503 × 848 and reported devicePixelRatio 1.1. The in-app browser capture produced 1366 × 771 pixels. The source was downsampled to that capture size for the combined full-view input. The focused comparison resized the source card to the rendered card crop (551 × 183 pixels). These comparisons establish visual composition, not a pixel-exact screenshot diff: the browser capture has a projection/crop offset relative to CSS geometry. DOM measurements were used for component dimensions and overflow checks, not to manufacture replacement screenshots.

Mobile evidence: `/private/tmp/noqueue-figma-review/implementation-mobile.jpg` (342 × 1339 pixels), a 390 CSS-pixel outer viewport with 376 usable content pixels; document scrollWidth = clientWidth = 376. Additional minimum-content evidence: `/private/tmp/noqueue-figma-review/implementation-mobile-minimum-content.jpg`, 336 outer / 322 usable CSS pixels, scrollWidth = clientWidth = 322. Cards become one column and long names wrap without overlapping controls. Mobile captures visibly lose part of the right edge through the same browser capture projection; DOM measurements distinguish that capture limitation from actual overflow. No mobile Figma target was supplied, so this is responsive QA rather than mobile pixel matching.

## Comparison history

1. Initial comparison (`/private/tmp/noqueue-figma-review/comparison-before.png`) was blocked by P2 local drift: heading top inset, tab height/rhythm, 24px rather than 20px grid gaps, semibold card titles, 20px badges, missing 28px service-icon wrapper, circular Avatar fallback decoration, and footer button height.
2. A single scoped Commercial.tsx visual correction applied desktop-local 20px top inset, 26px heading/tab separation, 30px main groups, 20px grid gaps, regular 17px titles, 13px company copy, 26px badges, a 28px icon wrapper, square fallback decoration and intrinsic footer-action height with expanded pointer area. Shared shell and fonts were not changed.
3. Final full-view and focused comparison above was recaptured after the functional corrections. No actionable P0/P1/P2 redesign drift remains. Card height is content-driven (~199.6 CSS px versus the reference's ~196), intentionally avoiding clipping.
4. Independent functional review found two P2 edge cases: pending search lost during local filter/page navigation, and undefined service counts in legacy responses. Both received failing tests before correction (3 failed / 20 passed), then passed (23 / 23). Local navigation now flushes the draft atomically, while real history navigation resets stale drafts. Missing metadata displays an honest unavailable state.
5. Bounded readback found the same pending-search class on detail navigation. A failing regression covered custom return and native Back (2 failed / 23 passed). A shared list-parameter helper and replacement of the original list URL before Link navigation corrected it (25 / 25). Tests also prove no additional history entry and no delayed mutation of the detail URL. Independent final readback passed; the final combined visual evidence was recaptured after the source freeze.

## Fidelity findings

- **Fonts/typography:** project font and shared heading style retained as approved, rather than replacing them with Figma's font. Regular 17px card titles, company hierarchy and mobile wrapping reviewed. Different antialiasing and browser density prevent exact glyph matching.
- **Spacing/layout:** two desktop columns, one mobile column, 20px grid gap, 24px card padding, 12px radius and 44px initials are preserved. Tabs, filters, dividers and independent action alignment were inspected in combined evidence. The shared shell's positioning is an approved existing-project constraint.
- **Colors/tokens:** light surfaces, subtle borders/shadows, dark selected filter and create button, emerald active and muted inactive badges preserve the design hierarchy while using existing project tokens.
- **Assets:** the six supplied SVG icons are stored locally; no custom icon approximations or transient Figma asset URLs. Icons remain sharp and correctly scaled in focused evidence. Initials are the intended design, not substitute imagery.
- **Copy/content:** title, subtitle, tabs and filters match the reference; dates represent actual configuration metadata. Unknown dates/counts display explicit unavailable copy. Company-status confirmation explains all establishments are affected. Metrics contains only the approved future-availability placeholder.

### Residual limitations / follow-up polish

- P3: content-driven cards are approximately 4px taller than the reference; do not force a height that clips wrapped content.
- Existing app-wide boundary: at a 320px outer viewport with a 14px desktop scrollbar, body min-width:320px creates a 14px document overflow. Verified on HEAD in `/Users/usuario/Sites/noqueue-app.com/apps/web/src/index.css`; it is not introduced by this redesign. A shared-shell responsive change is outside this scope. The redesign was additionally verified at 322 useful content pixels without overflow.
- No production deployment, real credentials, or live authenticated browser-to-API smoke test was performed. Unit/API tests and the fixture browser preview are separate evidence.

## Interaction and verification evidence

- Browser: Metrics placeholder; return to Establishments; inactive filter and URL; search debounce and URL; clearing search; active/inactive menus; company-wide confirmation; cancel focus restoration; Cmd+K search focus; Cmd+K does not steal focus from AlertDialog.
- Console: warning/error log inspection returned an empty list after final capture.
- Tests: full web 303 passed; API writer run 121 passed; independent API subset 76 passed. Focused web suite 25 passed after edge-case fixes, independently rerun by the verifier and parent. Types: 5 tasks passed. Build: 4 tasks passed, API dry-run only, no deployment.
- TDD disclosure: initial UI RED and later edge-case RED/GREEN were observed. The initial API test executed zero tests due sandbox loopback/log restrictions; some backend changes preceded the first successful escalated API run. This is an initial API TDD chronology gap, not a claimed RED pass.

## Implementation checklist

- [x] Compare full view and focused card in combined source/render inputs.
- [x] Correct the observed local visual drift and recapture.
- [x] Verify responsive layout, primary keyboard/overlay interactions and console logs.
- [x] Correct independently identified draft-navigation and legacy-metadata regressions with failing tests first.
- [ ] Deployment operator: apply additive migration and API before releasing the interface. No deployment was authorized in this task.

final result: passed
