# Karaoke Studio implementation plan

Spec: `docs/superpowers/specs/2026-10-03-karaoke-studio-design.md`, issue #15.

- [x] Verify isolated Python3.11/Spleeter runtime and actual official model CPU inference.
- [x] Implement validated projects/cues and literal-text MP4 rendering with media verification.
- [x] Implement bounded offline separation worker and reproducible model setup/smoke scripts.
- [x] Implement loopback HTTP/job service, persistence, cancellation and request/file protections.
- [x] Build complete browser upload/audition/lyric-timing/project/export flow and tests.
- [x] Verify real-model end-to-end flow, independently review and fix findings.
- [ ] Commit/push durable milestone and update issue/catalog/PR; reassess next work.

Verification: 52 Python tests, 3 TypeScript tests, 10 production Chromium tests, Ruff, ESLint, typecheck/build, real 1/10/30-second offline model smokes, actual singing-clip browser-to-MP4 flow and ffprobe/frame inspection. Independent review findings fixed and reproduced checks passed; details in app docs/verification.md.
