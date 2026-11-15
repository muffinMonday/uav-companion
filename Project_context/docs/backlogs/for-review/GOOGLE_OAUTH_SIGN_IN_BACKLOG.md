# Google OAuth Sign-In Backlog

**Status:** Released 2026-11-15 (commit `f3b4933` on `main`, `deploy:live` gh-pages `02cb2a0`). Live local Google run by the owner; Pages subpath run still open.
**Scope:** Google sign-in for the existing optional Supabase account system, frontend only
**Planning date:** 2026-11-15; reviewed against `main` at `8c80271` the same day

## Status history

- 2026-11-15: draft written from the `muffinMonday/uav-companion` `main` branch.
- 2026-11-15: reviewed against the working tree. Source code is authoritative. Corrections and decisions are in "Review findings" and "Decisions".
- 2026-11-15: Phase 0 same-email check (owner, local dev on `localhost:5173`, hosted project): magic link with Gmail, sign out, then Google via the Supabase authorize URL with `redirect_to=http://localhost:5173/`. Owner reports the Google sign-in was recognised as the same account. Owner then confirmed in *Authentication → Users* that the user ID is unchanged and Google is listed as an identity (owner report; IDs not copied into this file).
- 2026-11-15: owner decisions O1 to O4 and D4 recorded. Google Cloud client created (Web application; redirect URI `https://tgptrtcuaryyyfzhrffm.supabase.co/auth/v1/callback`; scopes `openid`, `userinfo.email`, `userinfo.profile`). Client ID and secret saved in the hosted project's Google provider, which is enabled. Hosted URL Configuration (Site URL and redirect allow-list) checked by the owner and confirmed correct.
- 2026-11-15: **implemented (uncommitted)**. Phase 1: `signInWithGoogle()` in `src/sync/supabase.js` (`signInWithOAuth`, provider google, `redirectTo` only, no scopes, flow still implicit) and the matching `{ ok, error }` method in `src/sync/engine.js`. Phase 2: **Continue with Google** in the guest popover (`signInForm()` in `src/sync-ui.js`, order Google, "or use email", email form, one status line; both submit controls disabled while redirecting with "Opening Google…", reset on `pageshow`); `takeAuthReturnError()` reads `error` from the hash or query once on load, clears it, and `account-ui.js` opens the popover with "Google sign-in did not finish. Try again, or use the email link below." (provider text never shown; quiet on success). Denial: no marker, per owner (Google's rejected page never returns). Docs: DEVELOPMENT, ARCHITECTURE, MODULES, DESIGN section 25. No migration, no hosted setting changed.
- 2026-11-15: **verified (all MOCKED, no Google reached)**: `google-signin-unit` 16 pass (adapter call shape, no extra options, implicit flow, engine result shape, return-URL cases); browser `google-signin` 37 pass (idle, keyboard focus ring, redirecting, pageshow reset, failed return in hash and query form, reload does not repeat it, session-link stash survives, signed-in view quiet, success hash not treated as error, desktop and 390/360 phone dock sheet). `npm run test:unit` all suites pass. Full `node tests/run.mjs` (build with the dev Supabase values): every suite passes except `diag` (known, environmental: the :5173 preview does not serve `/src/log.js`). Unconfigured build: no account button, no Google button, no supabase.co request, supabase-js library chunk not fetched. Screenshots viewed: desktop and phone, light and dark.
- Not done: Pages subpath run, Google logo on the button, local-stack `[auth.external.google]`. Live local Google run done by owner (see the 2026-11-15 entry above).

- 2026-11-15: owner live run, local (`localhost:5173`), real Google: approval redirects back and signs in; denial leaves the same tab on Google's page with no return to the app (the expected result under "no marker"). Email link, same-email linking and the other popover states were reported as working. Owner decision (same day): the stranded Google page is acceptable; no new-tab change. Closing the Google tab, or going back to the app, opens the app as a guest. Not checked: Pages subpath.

- 2026-11-15: **released**. Commits `f3b4933` (feature) and `bfe0c5f` (deploy preflight fix: `scripts/preflight-data.js` read published data through `git archive` with CRLF conversion on Windows, so the Chengdu boundary hash check failed and blocked the deploy; now `core.autocrlf=false` for that read). `deploy:live` published; live `index.html` serves `index-Bulrl3dP.js`, which contains "Opening Google". Pages subpath check (owner) still open.

## Goal

Let users authenticate with Google while keeping the guest-first, local-first behaviour and the existing Supabase account, profile and cloud-data model. Email magic-link sign-in stays.

## Decisions (owner, 2026-11-15)

| # | Decision | Consequence |
|---|---|---|
| D1 | **Keep `flowType: 'implicit'`.** Add only `signInWithOAuth`. | No change to magic links, persisted sessions or hash handling. OAuth tokens return in the URL fragment, the same exposure magic links have today. Revisit PKCE only as its own backlog (it would require same-browser magic links). |
| D2 | **Keep "Create a profile" as is** (default taken under "minimal impact"; not asked). | `src/splash.js:43` already calls `cloud.handle.open()`, which opens the account popover where Google will appear. A rename can follow after the live test. |
| D3 | **Release acceptance requires a live run** with the real Google OAuth client, on local and on the Pages URL, including the magic-link-first then Google case. | Needs a Google Cloud OAuth client and a test Google account before Phase 3 can close. Mocked tests are reported as mocked. |
| D4 | **Phase 0 runs on the hosted development project** (`tgptrtcuaryyyfzhrffm`, which `DEVELOPMENT.md:53` names as the development project), not a throwaway project. The owner has no capacity for a second Supabase project. | Phase 0 creates or links auth users on the hosted project: use the owner's own Google account and email for same-email cases. The different-email case is optional; if run, delete its extra auth user afterwards. Only the Google provider and redirect list are changed, and both are already set. Supersedes the throwaway-project wording in Phase 0 and the setup steps below. |

## Review findings (code vs the draft)

Confirmed in source:

- `src/sync/supabase.js:9`: `persistSession`, `autoRefreshToken`, `detectSessionInUrl: true`, `flowType: 'implicit'`. Line 15: `signIn(email)` calls `signInWithOtp` with `emailRedirectTo = location.origin + location.pathname` (the `redirectTo` default, line 7). Line 17: `onAuthChange` forwards only `SIGNED_IN` and `SIGNED_OUT`. supabase-js and auth-js are 2.119.0.
- `src/sync/engine.js:152` wraps `adapter.signIn` as `{ ok, error }`. `src/sync-ui.js:175` runs `sync.sync()` on every auth change. `src/sync-ui.js:57-72` builds the email form (`signInForm()`), with a `role="status"` line.
- `src/account-ui.js:60-67`: the guest popover is the "Not signed in" heading, a hint, `handle.signInForm()`, then the "Export or import your data" link. The signed-in view starts at line 69. The same popover serves the panel-header and dock buttons (`paintButtons`, lines 40-48).
- `src/splash.js:42-43`: "Continue as guest" and "Create a profile" already exist.
- `vite.config.js:5`: `base: './'`, so `origin + pathname` is `/uav-companion/` on Pages and `/` locally. `supabase/config.toml:16` allow-lists `http://localhost:5173` and `https://muffinmonday.github.io/uav-companion/`.
- Ownership: every migration references `auth.users (id)`. Grep of `supabase/migrations` and `supabase/functions` finds no use of email for access or ownership. **No app migration is needed.**
- Hash readers do not collide with an OAuth `#access_token=`: `src/ai-ui.js:262` matches only `#import=`; `src/sessions-hub.js:566` parses its own token and stashes it in `sessionStorage` (`PENDING`). Because `redirectTo` drops the hash, that stash is what carries a pending session link across the redirect (to be tested, Phase 3).

Corrections to the draft:

- The draft says the hosted provider settings are "managed separately". They cannot be read from the repo. `supabase/config.toml` configures only the local stack and has no `[auth.external.google]` block.
- `DEVELOPMENT.md:53` lists "closed sign-ups" and "email confirmation on" as the release checklist. Closed sign-ups would also block **new** Google users. Phase 1 must record this.
- The draft's cancel/failure state is not automatic. An implicit-flow return after a cancel or provider error carries `error` and `error_description` in the URL and fires no `SIGNED_IN` event, so the app has to read them (see open item O1).

## Product and UI specification

### Entry point

In the guest view of `src/account-ui.js` (line 63), add a **Continue with Google** button between the hint and the email form, then a short "or use email" label, then the unchanged email form and "Export or import" link. Build the button next to `signInForm()` in `src/sync-ui.js` (for example `googleButton()`) so both methods share the status line and the disabled state. No new route, full-page gate, banner or dashboard card.

### States

- Idle: Google button and the email form.
- Redirecting: both submit controls disabled, status "Opening Google…". The page is leaving, so also reset on `pageshow` (back navigation from the bfcache).
- Success: the existing `SIGNED_IN` path renders the signed-in popover and starts sync. No second profile initialisation.
- Cancelled or failed: the guest popover with a short recoverable message and the email option usable.
- Unconfigured build: no Google button and no Supabase load (unchanged).

Use `el()` and `textContent`, an accessible name, visible focus and the existing `btn` styles and touch targets (read `DESIGN.md` before styling).

## Phases

### Phase 0: Confirm linking and callback behaviour (hosted development project per D4, no app code)

1. On the hosted development project `tgptrtcuaryyyfzhrffm`, using the owner's own Google account and email, confirm and record:
   - magic-link-first, then Google with the same verified email: same `auth.users.id`, Google added as an identity;
   - Google-first, then magic link with that email (the mirror case): same ID;
   - a different email creates a separate user, and nothing merges existing separate users;
   - how a cancelled or denied Google return surfaces under the implicit flow (O1).
2. Confirm profile, `user_data` and other app data stay attached to that ID (follows from `auth.uid()` ownership; verify on the test project).

**Acceptance:** a written record of the four observations above, with Supabase and auth-js versions. No merge is claimed for separate existing user IDs.

### Phase 1: Adapter, provider and redirects

1. `src/sync/supabase.js`: add `signInWithGoogle()` calling `sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`, reusing the existing `redirectTo`. Request only the default identity scopes. Add a matching method to `src/sync/engine.js` returning `{ ok, error }` like `signIn`.
2. Configuration (owner-gated, outside this repo): create the Google OAuth client; set Supabase's Google provider with the client ID and secret in the dashboard; add `https://<project>.supabase.co/auth/v1/callback` as the Google authorised redirect URI; confirm the hosted redirect allow-list contains `http://localhost:5173` and `https://muffinmonday.github.io/uav-companion/`. Secrets never enter the repo or bundle.
3. Local stack: optionally add an `[auth.external.google]` block to `supabase/config.toml` reading its secret from an environment variable, only if the local live check needs it.
4. Record in `DEVELOPMENT.md` (hosted auth checklist) and `ARCHITECTURE.md` (line 22, which lists email only): the provider, the redirects, the closed-sign-up interaction, and "implicit flow retained (D1)".

**Acceptance:** OAuth reaches Google and returns to the right local or Pages URL; no secret in the bundle; an unconfigured build stays guest-only.

### Phase 2: Popover integration

1. Add the button, divider label, redirecting, cancel and failure feedback in `src/sync-ui.js` and `src/account-ui.js` as specified above.
2. Read a callback error from the URL once on load, show it in the popover status line, and clear it from the address bar (with `history.replaceState`, as `ai-ui.js:264` does). Details follow Phase 0 findings.
3. Leave unchanged: first-run guest choice, export/import, sign-out wipe flow, profile, sync conflict dialog and community entries.

**Acceptance:** Google and email both work from the one popover on desktop and phone; a returning session renders the signed-in view; a cancelled or failed attempt can be retried or replaced by email.

### Phase 3: Verification and release readiness

Use the repo's unit and browser conventions (`/test-impact`; browser suites need a build with the `VITE_SUPABASE_*` values, see `CURRENT_STATUS.md`). Cover:

- Guest-only build with no Supabase configuration: no Google button.
- Adapter: `signInWithOAuth` called with the expected provider and redirect (mocked; labelled as mocked).
- Popover: idle, redirecting, cancelled, failed; keyboard operation, focus visibility, `role="status"` announcements; phone and desktop; panel-header and dock entry points.
- Callback URL with `#error=…` and with a session: popover state and URL cleanup; reload keeps the session.
- A pending session-link token survives the redirect.
- Email magic-link regression and sign-out.
- GitHub Pages subpath build.
- **Live run (D3):** real Google sign-in on local and on the Pages URL, the magic-link-first then Google same-email case, and a different-email case (existing local/cloud conflict dialog still applies). Report which of these were actually performed.

## Data and security boundaries

- No migration, RLS or SQL function change is expected. Reconfirm in Phase 0.
- Supabase Auth is the broker. The browser holds only the project URL and publishable key; the Google client secret lives in the Supabase provider settings.
- Identity scopes only. No Gmail, Drive, Calendar or other Google APIs.
- Never merge rows or change ownership by matching email in app code. Linking is Auth's job and depends on verified-email rules.
- Never overwrite device-local or cloud data on first sign-in; keep the existing conflict and backup dialogs.
- Do not show the Google email in the UI (the popover already hides it, `account-ui.js:69`).

## Open items (not guessed)

- **O1 (partly resolved, Phase 0, 2026-11-15):** denying the Google consent screen (owner test, same browser, hosted project) did **not** return to the app. Google showed its own page at `accounts.google.com/v3/signin/rejected` (path only recorded here; the full URL carries session parameters and is not stored). So the app receives no `error` parameter on denial and cannot detect it from its own URL. Live result (owner, 2026-11-15, local app on `localhost:5173`): after a denial the same tab stays on Google's page; it does not return to the app. Approval redirects back and signs in. Closing the Google tab (or going back) opens the app as a guest (owner, 2026-11-15). The stranded page after denial is accepted by the owner. Consequence for Phase 2: the "read `error` from the URL" fallback covers only returns that do reach the app (for example Supabase-side errors); a denial needs a different approach, such as a short-lived "sign-in started" marker that the app clears on its next load if no session appears. Phase 2 does not start until this is decided.
- **O2 (default, decided):** no automatic popover reopen on success; the account button's avatar state is the confirmation. On a failed or cancelled return, open the popover so the message is visible ("quiet on success, loud on failure").
- **O3 (default, to confirm at release):** allow Google sign-up for new users even if email sign-up is restricted, because Google accounts carry verified emails. Caveat: Supabase's `enable_signup` is project-wide, so closing email sign-up also closes Google sign-up for new users; if closed sign-ups are kept at release, Google works only for existing accounts. Decide when the `DEVELOPMENT.md:53` checklist is run, and record it as a deliberate choice.
- **O4 (partly done):** Google Cloud client created and provider saved on the hosted project. Hosted URL Configuration confirmed by the owner (Site URL and redirect allow-list containing `http://localhost:5173` and `https://muffinmonday.github.io/uav-companion/`). Setup is complete; a throwaway project is needed only if D4 is reversed.

## Non-goals

- Replacing Supabase Auth or adding a Google Identity SDK.
- Requiring an account for the map, point checks or local places and trips.
- Removing email magic links or migrating to PKCE (see D1).
- Google API access or importing Google data.
- Merging separate Supabase users or moving data between user IDs.
- A new auth page, password login or role system.
- Committing, pushing, deploying or changing hosted provider settings as part of planning.

## References

- Supabase, [Identity Linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- Supabase, [PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- Supabase, [Sign in with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
- `AGENTS.md` backlog lifecycle: this file stays in `docs/backlogs/for-review/` until implementation is authorised.
