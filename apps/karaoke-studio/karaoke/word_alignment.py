"""Bounded spelling-tolerant global word alignment, without a word-pair matrix."""
from array import array
from dataclasses import dataclass


class AlignmentLimitError(ValueError):
    """The bounded search could not finish; no estimated alignment is published."""


@dataclass
class AlignmentBudget:
    """Shared across a request, including all its word-highlight lines."""
    remaining: int = 1_000_000

    def spend(self, amount: int = 1) -> None:
        self.remaining -= amount
        if self.remaining < 0:
            raise AlignmentLimitError('These lyrics differ too much from recognition to align safely. '
                             'Use shorter lyrics or transcribe again; your saved lyrics are unchanged.')


def similar(a: str, b: str) -> bool:
    if a == b:
        return True
    if min(len(a), len(b)) < 3:
        return False
    if a[:3] != b[:3] and a[-2:] != b[-2:]:
        return False
    common = sum(1 for x, y in zip(a, b) if x == y)
    return common / max(len(a), len(b)) >= 0.6


def _signatures(tokens: list[str]) -> set[tuple[str, str]]:
    result = set()
    for token in tokens:
        result.add(('word', token))
        if len(token) >= 3:
            result.add(('prefix', token[:3]))
            result.add(('suffix', token[-2:]))
    return result


def _step(previous: array, score: int, diagonal: int, n: int, m: int) -> tuple[int, int, str]:
    """Furthest legal edit endpoint; substitutions win ties, then deletions."""
    def at(k):
        return previous[k + score] if -score <= k <= score else -1

    best = (-1, 0, '')
    for k, di, dj, move in ((diagonal, 1, 1, 'replace'),
                             (diagonal - 1, 1, 0, 'delete'), (diagonal + 1, 0, 1, 'insert')):
        i = at(k)
        j = i - k
        if i >= 0 and 0 <= j <= m and i + di <= n and j + dj <= m and i + di > best[0]:
            best = (i + di, k, move)
    return best


def _small_alignment(reference: list[str], heard: list[str]) -> list[int | None]:
    """Keep the established right-to-left tie choice for short lyric fragments."""
    n, m = len(reference), len(heard)
    previous = list(range(m + 1))
    moves = []
    for i in range(1, n + 1):
        current = [i] + [0] * m
        row = bytearray(m + 1)
        row[0] = 1
        ref = reference[i - 1]
        for j in range(1, m + 1):
            match = previous[j - 1] + (0 if similar(ref, heard[j - 1]) else 1)
            skip_ref = previous[j] + 1
            skip_heard = current[j - 1] + 1
            if match <= skip_ref and match <= skip_heard:
                current[j], row[j] = match, 0
            elif skip_ref <= skip_heard:
                current[j], row[j] = skip_ref, 1
            else:
                current[j], row[j] = skip_heard, 2
        moves.append(row)
        previous = current
    result: list[int | None] = [None] * n
    i, j = n, m
    while i > 0 and j > 0:
        move = moves[i - 1][j]
        if move == 0:
            if similar(reference[i - 1], heard[j - 1]):
                result[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif move == 1:
            i -= 1
        else:
            j -= 1
    return result



def align(reference: list[str], heard: list[str], budget: AlignmentBudget | None = None) -> list[int | None]:
    """Return monotone heard indices on a minimum unit-edit path.

    A frontier keeps the furthest reference offset for each edit count/diagonal,
    extending spelling-compatible words at zero cost. Traceback stores compact
    integer frontiers, not an n-by-m matrix. Work and storage are bounded by actual
    visited states/comparisons; unrelated vocabularies need no edit search at all.
    """
    if budget is None:
        budget = AlignmentBudget()
    n, m = len(reference), len(heard)
    budget.spend(n + m)
    if reference == heard:
        return list(range(n))
    result: list[int | None] = [None] * n
    if not n or not m or _signatures(reference).isdisjoint(_signatures(heard)):
        return result

    if n * m <= 4096:
        budget.spend(n * m)
        return _small_alignment(reference, heard)

    def extend(i, k):
        j = i - k
        while i < n and j < m:
            budget.spend()
            if not similar(reference[i], heard[j]):
                break
            i, j = i + 1, j + 1
        return i

    frontiers = [array('i', [extend(0, 0)])]
    score = 0
    while not (-score <= n - m <= score and frontiers[-1][n - m + score] == n):
        score += 1
        previous = frontiers[-1]
        current = array('i', [-1]) * (2 * score + 1)
        for k in range(-score, score + 1):
            budget.spend()
            i, _, _ = _step(previous, score - 1, k, n, m)
            if i >= 0:
                current[k + score] = extend(i, k)
        frontiers.append(current)

    i, j = n, m
    while score:
        start, previous_k, move = _step(frontiers[score - 1], score - 1, i - j, n, m)
        while i > start:
            result[i - 1] = j - 1
            i, j = i - 1, j - 1
        if move == 'replace':
            i, j = i - 1, j - 1
        elif move == 'delete':
            i -= 1
        else:
            j -= 1
        assert i - j == previous_k
        score -= 1
    while i:
        result[i - 1] = j - 1
        i, j = i - 1, j - 1
    return result
