"""Portable reports: escaped evidence, local anchors, and no inferred intent."""

from dataclasses import asdict
from html import escape
import json
import re
from urllib.parse import quote, urlsplit

from .model import Report

MAX_REPORT_BYTES = 8 * 1024 * 1024


def _bounded(text: str) -> str:
    if len(text.encode("utf-8")) > MAX_REPORT_BYTES:
        raise ValueError("Report exceeds 8 MiB. Select fewer lines or commits.")
    return text


def render_json(report: Report) -> str:
    return _bounded(json.dumps(asdict(report), ensure_ascii=False, indent=2) + "\n")


def _remote_url(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = urlsplit(value)
        if (parsed.scheme != "https" or parsed.hostname not in {"github.com", "gitlab.com"}
                or parsed.username or parsed.password or parsed.port or parsed.query
                or parsed.fragment):
            return None
        parts = parsed.path.strip("/").split("/")
        if len(parts) < 2 or any(not re.fullmatch(r"[\w.-]+", part) or part in {".", ".."}
                                 for part in parts):
            return None
        return f"https://{parsed.hostname}/{'/'.join(parts)}"
    except ValueError:
        return None


def _commit_anchor(commit: str) -> str:
    return "commit-" + quote(commit, safe="")


def render_html(report: Report) -> str:
    remote = _remote_url(report.remote_url)
    changes = {change.commit: change for change in report.changes}
    attributions = {}
    for line in report.blame:
        attributions.setdefault(line.commit, line)

    def external(commit: str) -> str:
        if remote and re.fullmatch(r"[0-9a-f]{40,64}", commit):
            segment = "/-/commit/" if "gitlab.com/" in remote else "/commit/"
            return f'<a class="external" href="{escape(remote + segment + commit)}" rel="noreferrer noopener" target="_blank">Open commit ↗</a>'
        return ""

    source_rows = []
    source_lines = report.source.split("\n")
    if source_lines and source_lines[-1] == "":
        source_lines.pop()
    for number, content in enumerate(source_lines, report.start_line):
        source_rows.append(f'<tr id="source-L{number}"><td class="line-number">{number}</td><td><code>{escape(content)}</code></td></tr>')

    blame_rows = []
    for line in report.blame:
        anchor = _commit_anchor(line.commit)
        blame_rows.append(
            f'<tr><td><a href="#source-L{line.final_line}">{line.final_line}</a></td>'
            f'<td><a href="#{anchor}"><code>{escape(line.commit[:10])}</code></a></td>'
            f'<td>{escape(line.author)}</td><td>{escape(line.summary)}</td>'
            f'<td><code>{escape(line.path)}:{line.original_line}</code></td></tr>'
        )

    timeline = []
    for change in report.changes:
        added = sum(line.startswith("+") and not line.startswith("+++") for line in change.patch.split("\n"))
        removed = sum(line.startswith("-") and not line.startswith("---") for line in change.patch.split("\n"))
        timeline.append(f'''<article class="change" id="{_commit_anchor(change.commit)}">
<div class="change-meta"><code>{escape(change.commit[:12])}</code><span>{escape(change.date)}</span>{external(change.commit)}</div>
<h3>{escape(change.message.split(chr(10), 1)[0] or 'Commit without a message')}</h3>
<p class="muted">{escape(change.author)} · {added} added · {removed} removed lines in the displayed range patch</p>
<details open><summary>Commit message — quoted evidence</summary><pre class="message">{escape(change.message)}</pre></details>
<details><summary>Inspect the range-change patch</summary><pre class="patch">{escape(change.patch or 'No textual patch was returned for this commit.')}</pre></details>
</article>''')
    if not timeline:
        timeline.append('<p class="empty">No range-change patches available. Use the attribution below and review the completeness notes.</p>')

    # Every attributed commit has an embedded target even when a bounded timeline
    # does not include its full message/patch.
    other_commits = []
    for commit, line in attributions.items():
        if commit in changes:
            continue
        other_commits.append(f'''<article class="attribution" id="{_commit_anchor(commit)}"><div class="change-meta"><code>{escape(commit[:12])}</code>{external(commit)}</div><h3>{escape(line.summary)}</h3><p>{escape(line.author)} · {escape(line.timestamp)}</p><p class="muted">Summary recorded by blame. A full message and range patch are not included in this bounded report; intent remains unknown.</p></article>''')

    rename_rows = []
    for rename in report.renames:
        known = rename.commit in changes or rename.commit in attributions
        label = escape(rename.commit[:10])
        link = f'<a href="#{_commit_anchor(rename.commit)}">{label}</a>' if known else f'<code>{label}</code> {external(rename.commit)}'
        rename_rows.append(f'<tr><td>{link}</td><td><code>{escape(rename.old_path)}</code></td><td><code>{escape(rename.new_path)}</code></td><td>{rename.similarity}%</td></tr>')

    warnings = ''.join(f'<li>{escape(warning)}</li>' for warning in report.warnings)
    if not warnings:
        warnings = '<li>No additional completeness warnings were reported within the configured limits. This is not proof of complete semantic history.</li>'
    attribution_section = '<h3>Additional attributed commits</h3>' + ''.join(other_commits) if other_commits else ''
    rename_content = ('<div class="table-scroll"><table><thead><tr><th>Commit</th><th>Previous path</th><th>New path</th><th>Similarity</th></tr></thead><tbody>' + ''.join(rename_rows) + '</tbody></table></div>') if rename_rows else '<p class="empty">No whole-file rename evidence was returned within the history limit.</p>'
    html = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>{escape(report.path)} — Git History</title><style>{STYLE}</style></head><body>
<a class="skip" href="#source">Skip to source</a><header><a class="brand" href="#overview"><span aria-hidden="true">↳</span> Git History</a><span class="badge">LOCAL EVIDENCE REPORT</span></header>
<div class="layout"><nav aria-label="Report sections"><p class="eyebrow">IN THIS REPORT</p><a href="#overview">Overview</a><a href="#source">Selected source</a><a href="#blame">Line attribution</a><a href="#timeline">Change timeline</a><a href="#renames">File renames</a><a href="#limits">Evidence & limits</a></nav>
<main><section id="overview" class="hero"><p class="eyebrow">UNDERSTAND THE HISTORY. INSPECT THE EVIDENCE.</p><h1>{escape(report.path)}</h1><p class="subtitle">{escape(report.repo_name)} · lines {report.start_line}–{report.end_line}</p><div class="revision"><span>COMMITTED SNAPSHOT</span><code>{escape(report.revision)}</code><span>requested as {escape(report.requested_ref)}</span></div><div class="metrics"><div><strong>{len(report.blame)}</strong><span>attributed lines</span></div><div><strong>{len(report.changes)}</strong><span>range changes</span></div><div><strong>{len(report.renames)}</strong><span>rename records</span></div></div></section>
<aside class="evidence-note"><strong>What this report can tell you</strong><p>Source, diffs and attribution show observed changes. Commit messages quote what their authors recorded. <strong>Intent is not established</strong> by a diff alone; absent an explicit explanation, the reason remains unknown. PR discussions and issue conversations have not been fetched.</p></aside>
<section id="source"><div class="section-title"><span>01</span><h2>Selected source</h2></div><p class="muted">Working-tree edits are excluded. Line numbers refer to the resolved commit.</p><div class="table-scroll source"><table aria-label="Selected committed source"><tbody>{''.join(source_rows)}</tbody></table></div></section>
<section id="blame"><div class="section-title"><span>02</span><h2>Line attribution</h2></div><p class="muted">Follow a commit to its embedded evidence. Original locations can differ after edits or renames.</p><div class="table-scroll"><table><thead><tr><th>Line</th><th>Commit</th><th>Author</th><th>Recorded summary</th><th>Original location</th></tr></thead><tbody>{''.join(blame_rows)}</tbody></table></div></section>
<section id="timeline"><div class="section-title"><span>03</span><h2>Change timeline</h2></div><p class="muted">Newest first. Patches show the selected range as Git traces it backwards.</p>{''.join(timeline)}{attribution_section}</section>
<section id="renames"><div class="section-title"><span>04</span><h2>File renames</h2></div><p class="muted">Git's similarity matching is heuristic. A rename is file-path evidence, not proof that a function kept the same meaning.</p>{rename_content}</section>
<section id="limits"><div class="section-title"><span>05</span><h2>Evidence & limits</h2></div><ul class="warnings">{warnings}</ul><p class="muted">No network requests or model-generated explanations were used. Missing history, merges, moves and rewritten code can limit attribution. Review the actual evidence before drawing conclusions.</p></section>
<footer>Generated locally by Git History · report schema {report.schema_version} · no external resources</footer></main></div></body></html>'''
    return _bounded(html)


STYLE = """
:root{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#253345;background:#f7f8fa;line-height:1.55}*{box-sizing:border-box}body{margin:0}a{color:#356381;text-decoration:none}a:hover{text-decoration:underline}a:focus-visible,summary:focus-visible{outline:3px solid #71a9bc;outline-offset:4px}header{height:82px;background:#fff;border-bottom:1px solid #e4e8ed;display:flex;align-items:center;justify-content:space-between;padding:0 4%}.brand{font-size:1.25rem;font-weight:750;letter-spacing:-.035rem;color:#233547}.brand span{background:#e3eef0;border-radius:8px;padding:.2rem .6rem;margin-right:.5rem;color:#497585}.badge,.eyebrow{font-size:.62rem;letter-spacing:.1rem;font-weight:750;color:#75868f}.badge{border:1px solid #dfe6e9;border-radius:30px;padding:.35rem .65rem}.layout{max-width:1400px;margin:auto;display:grid;grid-template-columns:210px minmax(0,1fr);gap:2rem;padding:2.5rem 3%}nav{position:sticky;top:2rem;align-self:start;display:flex;flex-direction:column;gap:.25rem}nav a{padding:.6rem .7rem;color:#647384;font-size:.85rem;border-radius:6px}nav a:hover{background:#e9eef2;text-decoration:none;color:#244c62}nav .eyebrow{padding:0 .7rem;margin-bottom:.8rem}main{min-width:0}h1,h2,h3,p{margin:0}h1{font-size:2rem;line-height:1.25;letter-spacing:-.06rem;overflow-wrap:anywhere}h2{font-size:1.2rem;letter-spacing:-.025rem}h3{font-size:1rem;overflow-wrap:anywhere}.hero{padding:0 0 1.5rem}.hero .eyebrow{margin-bottom:.8rem}.subtitle{margin-top:.6rem;color:#75818e;font-size:.9rem}.revision{display:flex;flex-wrap:wrap;gap:.4rem 1rem;align-items:center;margin-top:1.3rem;font-size:.7rem;color:#75818e}.revision code{overflow-wrap:anywhere;color:#456476}.revision span:first-child{font-size:.58rem;letter-spacing:.07rem;font-weight:700}.metrics{display:flex;gap:2.8rem;margin-top:1.8rem}.metrics div{display:flex;align-items:baseline;gap:.55rem}.metrics strong{font-size:1.5rem;font-weight:600}.metrics span{font-size:.72rem;color:#71818e}.evidence-note{border-left:3px solid #82a7aa;border-radius:0 8px 8px 0;background:#eaf1f1;padding:1rem 1.2rem;color:#49656b;margin-bottom:2rem}.evidence-note>strong{font-size:.8rem}.evidence-note p{margin-top:.4rem;font-size:.78rem;line-height:1.7}section{scroll-margin-top:1rem;margin-bottom:2.5rem}.section-title{display:flex;gap:.7rem;align-items:center;margin-bottom:.4rem}.section-title>span{font-size:.66rem;color:#9aa5b0;font-family:ui-monospace,monospace}.muted{color:#7b8592;font-size:.78rem;margin:.5rem 0 1rem}.table-scroll{overflow:auto;border:1px solid #e1e6ec;border-radius:9px;background:white}table{border-collapse:collapse;width:100%;font-size:.76rem;text-align:left}th{background:#f2f5f7;font-size:.64rem;letter-spacing:.02rem;font-weight:700;color:#758493;white-space:nowrap}td,th{padding:.7rem .8rem;border-bottom:1px solid #e9edf0;vertical-align:top}tr:last-child td{border-bottom:0}code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,Liberation Mono,monospace;font-size:.75rem}td code{white-space:pre}.source td{border:0;padding:.15rem .8rem}.source table{margin:.8rem 0}.source td:last-child{white-space:pre}.line-number{color:#9ba9b5;text-align:right;width:48px;user-select:none}.change,.attribution{border:1px solid #e1e6ec;background:#fff;border-radius:10px;padding:1.15rem 1.3rem;margin-top:1rem}.change-meta{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1rem;color:#83909b;font-size:.68rem;margin-bottom:.6rem}.change-meta code{color:#4c7288;font-size:.7rem}.external{margin-left:auto;font-size:.68rem}details{margin-top:.9rem}summary{cursor:pointer;font-size:.75rem;font-weight:600;color:#577080}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;border:1px solid #e5ebef;background:#f8fafb;border-radius:6px;padding:.9rem;margin:.65rem 0 0}.patch{white-space:pre;overflow:auto;max-height:420px}.warnings{padding:1rem 1rem 1rem 2rem;border:1px solid #e6dfce;border-radius:8px;background:#faf8f0;font-size:.8rem;color:#786a4e}.warnings li+li{margin-top:.5rem}.empty{padding:1rem;border:1px dashed #d6dfe5;border-radius:8px;color:#7e8997;font-size:.78rem}footer{border-top:1px solid #e2e7ec;padding:1rem 0;color:#8e98a2;font-size:.65rem}.skip{position:absolute;left:1rem;top:-100px;background:white;padding:.5rem;z-index:2}.skip:focus{top:1rem}@media(max-width:800px){.layout{display:block;padding:1.5rem 1rem}nav{position:static;flex-direction:row;flex-wrap:wrap;gap:.2rem;margin-bottom:1.5rem}nav .eyebrow{display:none}nav a{font-size:.72rem;padding:.4rem .6rem}header{padding:0 1rem;height:70px}.badge{font-size:.5rem}h1{font-size:1.55rem}.metrics{gap:1rem;flex-wrap:wrap}.metrics div{gap:.35rem}.metrics span{font-size:.65rem}.change,.attribution{padding:1rem}.revision code{font-size:.65rem}}
"""
