# Direct-commit issue context — #314

Autonomous inline execution under standing authorization. Goal: show explicitly cited issue descriptions alongside direct-commit evidence, without inventing intent. Existing opt-in GitHub retrieval only follows PR associations. Add at most eight unique referenced issues from checked report range-change commits without a PR; accept explicit closes/fixes/resolves/refs/references #N and standalone (#N), not bare hashes or foreign URLs. Source messages, Git ordering and commits remain authoritative only about what was cited, not causation/closure. Quote issue text as unverified and possibly edited.

Architecture: additive referenced-issue record with commit associations in retrieved report JSON; existing bounded client, strict returned issue type/number/repository URLs, capped text, deadline/cancel/failure semantics. HTML has issue source/commit anchors and truncation markers. Synopsis and workbench explain this opt-in scope; no network in default mode and no issue comment retrieval. Reuse existing Python/Git/loopback/native browser harness. No AI, paid API or repo mutation.

- [x] RED direct-commit actual CLI JSON/HTML, parser/refusal/limit/partial retrieval cases.
- [x] Implement retrieval/model/render/synopsis and workbench wording.
- [x] Native opt-in direct commit report/download evidence; full project checks and fresh review.
- [ ] Connected GitHub commit, canonical CI, actual acceptance record and issue closure.
