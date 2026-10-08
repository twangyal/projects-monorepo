"""Portable, script-free rendering of explicit committed source comparisons."""
from dataclasses import asdict
from html import escape
import json

from .comparison import ComparisonReport, ComparisonSide, validate_comparison
from .render import MAX_REPORT_BYTES
from .work_budget import check_work_budget


def _bounded(text: str) -> str:
    check_work_budget()
    if len(text.encode('utf-8')) > MAX_REPORT_BYTES:
        raise ValueError('Comparison report exceeds 8 MiB; select smaller source regions.')
    check_work_budget()
    return text


def _literal(value: str) -> str:
    # HTML's input parser otherwise normalizes a literal carriage return.
    return escape(value, quote=True).replace('\r', '&#13;')


def _tokens(source: str) -> list[str]:
    if not source:
        return []
    pieces = source.split('\n')
    result = [piece + '\n' for piece in pieces[:-1]]
    if pieces[-1]:
        result.append(pieces[-1])
    return result


def render_comparison_json(report: ComparisonReport) -> str:
    """Render the admitted immutable comparison, preserving exact selected text."""
    check_work_budget()
    report = validate_comparison(report)
    check_work_budget()
    return _bounded(json.dumps(asdict(report), ensure_ascii=False, indent=2) + '\n')


def _metadata(name: str, side: ComparisonSide) -> str:
    status = ('Verified absent at pinned revision' if side.status == 'missing' else
              'Present empty source' if not side.source else 'Present source')
    bounds = ('None (0 selected lines)' if side.start_line is None else
              f'{side.start_line}–{side.end_line}')
    selection = side.selection.kind
    if selection == 'lines':
        selection += f' {side.selection.start}:{side.selection.end}'
    rows = [('Requested ref', side.requested_ref), ('Immutable revision', side.revision),
            ('Exact path', side.path), ('Status', status), ('Selection', selection),
            ('Selected function', side.selected_function or 'None'),
            ('Original line range', bounds),
            ('Selected text SHA256', side.source_sha256 or 'None (absent)')]
    details = ''.join(f'<dt>{label}</dt><dd>{_literal(value)}</dd>' for label, value in rows)
    return f'<section aria-labelledby="{name}-heading"><h2 id="{name}-heading">{name.title()} source</h2><dl>{details}</dl></section>'


def _cell(name: str, side: ComparisonSide, tokens: list[str], index: int | None) -> str:
    if index is None:
        return '<td class="number"></td><td class="source absent" aria-label="No paired line">—</td>'
    line = side.start_line + index
    token = tokens[index]
    if token.endswith('\r\n'):
        content, ending = token[:-2], 'CRLF'
    elif token.endswith('\n'):
        content, ending = token[:-1], 'LF'
    else:
        content, ending = token, 'No final LF'
    anchor = f'{name}-L{line}'
    return (f'<td class="number" id="{anchor}"><a href="#{anchor}" aria-label="{name.title()} line {line}">{line}</a></td>'
            f'<td class="source"><code>{_literal(content)}</code><span class="eol">{ending}</span></td>')


def render_comparison_html(report: ComparisonReport) -> str:
    """Render a standalone literal alignment with explicit positional pairing."""
    check_work_budget()
    report = validate_comparison(report)
    check_work_budget()
    left, right = _tokens(report.left.source), _tokens(report.right.source)
    rows = []
    for block in report.blocks:
        check_work_budget()
        for offset in range(max(block.left_end - block.left_start,
                                block.right_end - block.right_start)):
            check_work_budget()
            li = block.left_start + offset
            ri = block.right_start + offset
            rows.append(f'<tr class="{block.kind}">'
                        + _cell('left', report.left, left, li if li < block.left_end else None)
                        + _cell('right', report.right, right, ri if ri < block.right_end else None)
                        + '</tr>')
    if not rows:
        rows.append('<tr><td colspan="4">No selected lines on either side.</td></tr>')
    check_work_budget()
    text = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'">
<title>Committed source comparison</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f5ef;color:#182b31;font:16px/1.5 system-ui,sans-serif}
main{max-width:1500px;margin:auto;padding:24px}h1,h2{line-height:1.2}nav{display:flex;gap:20px;flex-wrap:wrap}
a{color:#165a70}a:focus-visible{outline:3px solid #ce8328;outline-offset:3px}
.provenance{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}section{min-width:0}
dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 12px}dt{font-weight:600}dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.alignment{overflow-x:auto;border:1px solid #a3b5b5}table{border-collapse:collapse;width:100%;table-layout:fixed}
th,td{border:1px solid #ced8d5;padding:6px;vertical-align:top;text-align:left}th{background:#e2ebe6}
.number{width:60px;font-variant-numeric:tabular-nums}.source{white-space:pre-wrap;overflow-wrap:anywhere}
code{font:14px/1.5 ui-monospace,monospace}.eol{display:block;color:#4b5f64;font:11px system-ui,sans-serif}
.change td:nth-child(2){background:#ffe9e2}.change td:nth-child(4){background:#e2f4df}.absent{color:#667675}
@media(max-width:700px){main{padding:12px}.provenance{grid-template-columns:1fr}dl{grid-template-columns:1fr}dd{margin-bottom:8px}table{min-width:650px}}
</style></head><body><main>
<h1>Committed source comparison</h1>
<nav aria-label="Report sections"><a href="#provenance">Source provenance</a><a href="#alignment">Numbered alignment</a></nav>
'''
    text += (f'<p>Repository: {_literal(report.repo_name)}</p>'
             '<p>This compares explicitly selected committed regions. It does not establish semantic identity, rename correspondence, moved lines, author intent or patch applicability.</p>'
             f'<p><strong>{report.unchanged_lines}</strong> unchanged lines · '
             f'<strong>{report.removed_lines}</strong> removed lines · '
             f'<strong>{report.added_lines}</strong> added lines</p>'
             '<div class="provenance" id="provenance">'
             + _metadata('left', report.left) + _metadata('right', report.right) + '</div>'
             '<p>SHA256 describes exact selected UTF-8 text integrity, not provenance authenticity.</p>'
             '<h2 id="alignment">Numbered alignment</h2>'
             '<p>Changed rows use positional pairing of unmatched lines in original order for readability; this presentation is not semantic correspondence. Blank cells have no paired line. End markers distinguish LF, CRLF and No final LF without normalizing text.</p>'
             '<div class="alignment"><table aria-label="Selected source alignment"><colgroup><col style="width:60px"><col><col style="width:60px"><col></colgroup>'
             '<thead><tr><th scope="col">Left line</th><th scope="col">Left text</th><th scope="col">Right line</th><th scope="col">Right text</th></tr></thead>'
             '<tbody>' + '\n'.join(rows) + '</tbody></table></div></main></body></html>\n')
    return _bounded(text)
