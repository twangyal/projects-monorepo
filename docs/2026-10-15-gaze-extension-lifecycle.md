# Gaze extension lifecycle and current-page recovery — #258

## Outcome

The extension is the primary product under the owner's 2026-10-14 direction.
Turning it off and back on on the same website must create one working navigator.
Stop must also work while its modules or session settings are still loading.
The toolbar popup must distinguish the current document from remembered intent
for a previous document, and make failed checks and browsing choices recoverable.

## Changes and retained regressions

The injected content script owns each startup before its first asynchronous
boundary. The cached entry module exports an explicit factory, called once per
owned start. Stop retires that owner immediately. An older startup that finishes
or fails after a replacement cannot create an overlay or stop the replacement.

Background injection operations are serialized per tab. Explicit start, stop and
toggle requests retain their order, including two rapid toggles. Automatic
navigation decisions carry an intent token captured before their asynchronous
reads; a newer explicit operation retires them. Navigation reads continuation
state after earlier short operations have committed it. The worker does not wait
for camera/model/module startup, which would prevent Stop from being handled.

The popup probes the isolated world for off, starting, on, failed or unavailable
state. Starting is explicitly stoppable and polls until it settles. The old
boolean status message remains compatible but now also probes the current page.
Permission refusal and preference-save failures have separate visible feedback;
failed checks offer Retry rather than an apparently usable stale toggle. The
page help distinguishes enabling the panel from enabling speech or camera.

Actual shipped modules are tested with real ESM caching and controlled asynchronous
storage, replacing only the overlay's DOM boundary. Background and popup tests
execute their shipped scripts against controlled Chrome APIs. Retained red/green
reproductions cover cached restart, cancelled startup, stale page status,
permission/save feedback, an old navigation decision after Stop, old startup
success/failure after replacement, rapid explicit-operation ordering, and a
retired status poll failing after a newer successful toggle.

Independent review found the navigation continuation and rapid-toggle ordering
cases. Both were reproduced before fixing and retained as regressions; the final
review reported no remaining material defect in this bounded change.

## Verification

Local Node tests: **163 passed**. Lint checks **88 JavaScript files**; test
extension packaging passes. Local portable Chromium cannot load extension service
workers, so its failed fixture initialization is a tooling limitation, not a
native-extension pass. The full Chromium hosted source and main gates below
provide the native extension evidence and exact accepted revisions.

The native additions load the built test extension into full Chromium and cover:

- Three same-page start/stop cycles, exactly one overlay, and off status after a
  normal navigation with persistence disabled.
- A delayed genuine extension-storage read, Stop, a successful replacement, and
  release of the old read without removing the replacement.
- The actual popup HTML/script controlling a website and describing a protected
  browser page with disabled toggle and visible recovery.

These run alongside the existing strict-CSP, isolated-world privacy, navigation,
camera adapter, calibration continuity, model adapter and practice-site cases at
all four configured viewport sizes. The test build grants host access and uses
fake camera/model adapters. It does not establish physical input performance or
native toolbar/permission-prompt interaction.

## Physical extension acceptance still required

Use a freshly built production extension and a normal Chrome profile. Record the
Chrome/OS version, viewport, website/task, and which website-access choice was
used. Do not record audio, eye images or private page text in repository evidence.

1. Load the unpacked extension using the README instructions. On a normal website,
   open the actual toolbar popup. Turn it on, off and on again; confirm one usable
   context panel, correct current-page status and no duplicate response.
2. Before choosing persistent or automatic browsing, refuse the optional website
   access prompt. Confirm the choice stays off and refusal remains readable. Then
   grant access deliberately and check the chosen browsing behavior, including
   explicit Stop followed by navigation and ordinary navigation without persistence.
3. Turn on the page panel and start listening. Exercise the real microphone prompt,
   denial/retry, spoken instruction, clarification, confirmation and immediate
   cancel. Confirm the panel can be used through typed instructions if speech fails.
4. Enable camera, exercise denial/retry and timed calibration, then navigate with
   persistence enabled. Check whether calibration reuse is usable at unchanged
   viewport size and that resize requests recalibration. Stop releases physical
   input; restart must not restore an already cancelled pending action.
5. Check the popup's actual shortcut assignment. If it is unassigned or still
   conflicts with command entry, use Chrome shortcut settings and verify both
   shortcuts with the physical keyboard. Open a protected browser page and check
   the actual popup's recovery message.
   Return to a normal website and reopen it. Also check keyboard access, focus,
   announcements and readability with intended users and their assistive tools.

Report task completion, unwanted actions, effort, recovery, camera drift and
calibration reuse separately from automated counts. Issue #132 remains the
physical-input evaluation tracker. Gaze remains ACTIVE: distribution, broader
real-site evaluation and intended-user acceptance are not delivered by #258.

## Extension-first onboarding — #259

`apps/gaze-navigator/extension-setup.html` provides a focused setup flow, reached
from the landing page and built-in bookshop. Native disclosure controls expose
local-build/load instructions and optional speech, camera and matching details.
The page explains deliberate page-only versus optional continued access, a first
website task, cancellation and recovery. It requests no devices and makes no
installation-detection claim. Built-in practice is explicitly separate; users
are told to leave the extension off there to avoid duplicate panels.

Review corrected a first-task instruction that asked for “go back” after default
page-only navigation had already removed the panel. The guide now explains
reactivation at the destination or the selected tab-continuation behavior.

Eight local onboarding browser cases passed across all four configured viewport
sizes, covering the landing entry, keyboard disclosure, build instructions,
no horizontal overflow, handoff to the actual built-in navigator, no unsolicited
external/device requests, and retained dwell calibration. Desktop and 390×480
screenshots were visually inspected. These are browser usability checks, not
real installation or intended-user acceptance.

## Separate shortcut responsibilities — #260

The extension manifest and the in-page command editor previously both used
Alt+Shift+G for incompatible actions. A retained regression feeds the actual
manifest binding through the actual keyboard command controller and proved the
collision before the fix. The new suggested extension on/off binding is
Alt+Shift+N; command entry keeps Alt+Shift+G. The popup, setup guide and README
explain the distinction and `chrome://extensions/shortcuts` for retained or
custom bindings. The popup queries the actual command registry independently of
page controls: it reports assigned/custom keys, warns about a conflicting legacy
Alt+Shift+G (including Option/symbol variants), explains unassigned keys, and keeps
the toolbar usable if lookup fails. No user-assigned shortcut is changed
programmatically.

The additional native case checks Chrome's actual registered command, then uses
the installed extension's command editor to cancel and submit while preserving
website focus, the website draft and the ordinary instruction draft. This checks
the registry and browser command-entry path, not physical operating-system
shortcut dispatch. Chrome/system reservations or user customizations can require
a different binding; the toolbar remains available. See Chrome's
[Commands API](https://developer.chrome.com/docs/extensions/reference/api/commands).

Final local combined gate: **166 unit tests**, syntax over **89 JavaScript
files**, test extension build and diff whitespace check pass. The hosted source
and main results below complete the automated acceptance record.


## Production packaging check

The non-test `npm run build:extension` completed locally on 2026-10-15. Its
production path fetched and SHA-256-verified WebGazer 3.3.0, ONNX Runtime Web
1.23.0 and Hugging Face tokenizers 0.2.0. The packaged content script,
background, popup and entry matched their reviewed sources byte for byte.
The manifest retained optional-only `<all_urls>` access and the distinct
Alt+Shift+N suggested toggle. The real runtime WASM checksum was rechecked;
no fake estimator/model adapter was substituted in this package. The model
itself still downloads only on explicit request. This establishes packaging,
not a fresh live-model or physical-input evaluation.

## Hosted source acceptance

- Lifecycle source `e47bb84a01c099f0284e6497ebeb3ef832fef453`:
  [Gaze checks 38675959369](https://github.com/twangyal/projects-monorepo/actions/runs/38675959369)
  passes 163 unit and 252 full-Chromium browser cases, lint and build.
- Onboarding source `a5d27a039286b00899aacbf4bacde5a61ec3340a`:
  [Gaze checks 38676438784](https://github.com/twangyal/projects-monorepo/actions/runs/38676438784)
  passes 163 unit and 260 full-Chromium browser cases, lint and build. This exact
  commit was fast-forwarded into canonical main; its local unit rerun passes.
- Initial shortcut source `73ccba42f4b8f5691e2c1254927e6f2b16ed836b`:
  [failed checks 38676699235](https://github.com/twangyal/projects-monorepo/actions/runs/38676699235)
  passes 164 unit and 260 browser cases, but fails the four new cases at an
  overstrong registry assertion: every fresh headless profile reports the
  registered command with `shortcut: ''`, not the manifest suggestion. Chrome
  documents blank as inactive; the cause of this environment's unassignment was
  not established. This was not a pass of keyboard task behavior, since that
  assertion stopped those cases before the task steps.
- Follow-up source `8bd6f9e477044c6f29a18a19c8e7ddf929bb48d1`:
  [Gaze checks 38677801091](https://github.com/twangyal/projects-monorepo/actions/runs/38677801091)
  passes **166 unit and 264 full-Chromium browser cases**, lint and build.
  All four profiles still report a blank assignment; the complete keyboard/draft
  task passes at every viewport with truthful popup feedback. The corrected
  native case separately checks the actual loaded
  manifest, command presence, an active N or explicitly blank assignment, logs
  that assignment, checks truthful popup feedback, and executes the complete
  keyboard/draft task. The manifest/controller collision regression remains.
  Independent review found no material issue in this follow-up. Physical OS
  shortcut delivery remains unverified.


## Canonical integration

The final application subtree is `d816be2ca99c35d452358a15dae87d1a546c8699`,
identical to accepted source `8bd6f9e477044c6f29a18a19c8e7ddf929bb48d1`.
Later checkpoint/integration changes affect only this record and
`PROJECT_IDEAS.md`. The first two milestones are already on main at
`a5d27a039286b00899aacbf4bacde5a61ec3340a`; the final integration includes their
reviewed history and the accepted shortcut follow-up.

Main integration `eab6f9402279c744b7f09f30316fa801093fb681` passes
[Gaze checks 38678684336](https://github.com/twangyal/projects-monorepo/actions/runs/38678684336):
**166 unit tests, 264 full-Chromium browser cases, lint and build**. The main
checkout's separate local unit rerun also passes 166 tests. All four main
profiles retain the explicitly logged blank assignment and complete the keyboard
and draft-preservation task. The earlier main onboarding gate
[38677836483](https://github.com/twangyal/projects-monorepo/actions/runs/38677836483)
also passes 163 unit and 260 browser cases. Issues #258, #259 and #260 are closed.
This final receipt changes only root documentation; the accepted app subtree
remains unchanged. Project #8 remains SKIP, and the owner-deferred projects are
untouched. Physical-input acceptance remains open in #132.
