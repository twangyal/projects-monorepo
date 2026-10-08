"""Bounded stdlib inference reference for the frozen local experiment.

This module never reads corpora or learns a policy. The independent evaluator
must reproduce the contract without importing this implementation.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import re
from typing import Any

HERE = Path(__file__).resolve().parent


def sha256(path: Path) -> str:
    if path.name.startswith('heldout-'):
        raise ValueError('Training/reference ownership excludes held-out files.')
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _unique(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key.')
        result[key] = value
    return result


def _depth(text: str, maximum: int) -> None:
    depth = 0
    quoted = escaped = False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in '[{':
            depth += 1
            if depth > maximum:
                raise ValueError('JSON exceeds depth bound.')
        elif char in ']}':
            depth -= 1
            if depth < 0:
                raise ValueError('Malformed JSON nesting.')


def read_json(path: Path, maximum_bytes: int = 1048576, maximum_depth: int = 12) -> Any:
    if path.name.startswith('heldout-'):
        raise ValueError('Training/reference ownership excludes held-out files.')
    with path.open('rb') as stream:
        raw = stream.read(maximum_bytes + 1)
    if len(raw) > maximum_bytes:
        raise ValueError('JSON exceeds byte bound.')
    text = raw.decode('utf-8', errors='strict')
    if text.startswith('\ufeff'):
        raise ValueError('JSON BOM is unsupported.')
    _depth(text, maximum_depth)
    return json.loads(text, object_pairs_hook=_unique,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite JSON.')))


def _number(value: Any, low: float, high: float) -> bool:
    return type(value) in (int, float) and low <= value <= high and math.isfinite(value)


def _same_json(left: Any, right: Any) -> bool:
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return set(left) == set(right) and all(_same_json(value, right[key]) for key, value in left.items())
    if isinstance(left, list):
        return len(left) == len(right) and all(_same_json(a, b) for a, b in zip(left, right, strict=True))
    return left == right


def validate_model(model: Any, contract: dict[str, Any], contract_hash: str) -> dict[str, Any]:
    if not isinstance(model, dict) or set(model) != set(contract['artifactSchema']['rootKeys']):
        raise ValueError('Unexpected artifact keys.')
    if type(model['schemaVersion']) is not int or model['schemaVersion'] != 1:
        raise ValueError('Unsupported artifact version.')
    for key in ('contractSha256', 'trainingSha256', 'developmentSha256'):
        if not isinstance(model[key], str) or not re.fullmatch('[0-9a-f]{64}', model[key]):
            raise ValueError('Invalid provenance hash.')
    if model['contractSha256'] != contract_hash:
        raise ValueError('Artifact contract hash mismatch.')
    for key in ('classOrder', 'canonicalMappings', 'screenDefaults', 'normalizer', 'rejectionPolicy', 'limits'):
        if not _same_json(model[key], contract[key]):
            raise ValueError('Artifact metadata differs from the frozen contract.')
    if not _same_json(model['dependencies'], contract['training']['dependencies']):
        raise ValueError('Artifact dependency provenance mismatch.')
    token_regex = re.compile("[a-z]+(?:'[a-z]+)*", re.ASCII)
    known = model['knownContentTokens']
    if (not isinstance(known, list) or not known or len(known) > 4096
            or any(not isinstance(word, str) or len(word) > 40 or not token_regex.fullmatch(word) for word in known)
            or known != sorted(set(known)) or any(word in contract['rejectionPolicy']['requestStopwords'] for word in known)):
        raise ValueError('Invalid known-content vocabulary.')
    vocabulary = model['vocabulary']
    if (not isinstance(vocabulary, list) or not 1 <= len(vocabulary) <= contract['limits']['vocabularyFeatures']
            or any(not isinstance(word, str) or len(word) > 80 for word in vocabulary)
            or vocabulary != sorted(set(vocabulary))):
        raise ValueError('Invalid feature vocabulary.')
    permitted = set(known) | set(contract['rejectionPolicy']['requestStopwords'])
    for feature in vocabulary:
        words = feature.split(' ')
        if not 1 <= len(words) <= 2 or any(not token_regex.fullmatch(word) or word not in permitted for word in words):
            raise ValueError('Invalid feature token.')
    length = len(vocabulary)
    if (not isinstance(model['idf'], list) or len(model['idf']) != length
            or any(not _number(value, 1, 100) for value in model['idf'])):
        raise ValueError('Invalid IDF vector.')
    for key in ('coefficients', 'centroids'):
        matrix = model[key]
        if not isinstance(matrix, list) or len(matrix) != 6:
            raise ValueError('Invalid class matrix.')
        low, high = (-1000000, 1000000) if key == 'coefficients' else (0, 1)
        for row in matrix:
            if not isinstance(row, list) or len(row) != length or any(not _number(value, low, high) for value in row):
                raise ValueError('Invalid matrix values/dimensions.')
            if key == 'centroids' and abs(math.sqrt(_sum(value * value for value in row)) - 1) > 1e-10:
                raise ValueError('Centroid is not normalized.')
    if (not isinstance(model['intercepts'], list) or len(model['intercepts']) != 6
            or any(not _number(value, -1000000, 1000000) for value in model['intercepts'])):
        raise ValueError('Invalid intercept vector.')
    thresholds = model['thresholds']
    if not isinstance(thresholds, dict) or set(thresholds) != {'minScore', 'minMargin', 'minSimilarity'}:
        raise ValueError('Invalid thresholds.')
    for name, value in thresholds.items():
        if not _number(value, 0, 1) or value not in contract['thresholdSelection'][name + 'Grid']:
            raise ValueError('Threshold was not selected from the frozen grid.')
    return copy.deepcopy(model)


def load_model(path: Path, contract_path: Path = HERE / 'training-contract.json') -> tuple[dict[str, Any], dict[str, Any]]:
    contract = read_json(contract_path)
    model = validate_model(read_json(path, contract['limits']['artifactBytes']), contract, sha256(contract_path))
    return model, contract


def normalize(text: Any, contract: dict[str, Any]) -> tuple[str | None, list[str] | None, str | None]:
    if not isinstance(text, str) or len(text) > contract['limits']['rawCodePoints']:
        return None, None, 'invalidInput'
    if any(ord(char) == 0 or 0xd800 <= ord(char) <= 0xdfff for char in text):
        return None, None, 'invalidInput'
    if len(text.encode('utf-8')) > contract['limits']['rawUtf8Bytes']:
        return None, None, 'invalidInput'
    trimmed = text.strip(' \t')
    if not re.fullmatch(contract['normalizer']['rawFullMatchRegex'], trimmed, flags=re.ASCII):
        return None, None, 'invalidInput'
    normalized = trimmed.lower()
    if normalized[-1] in '.!?':
        normalized = normalized[:-1]
    normalized = re.sub('[ \\t]+', ' ', normalized.replace('-', ' '))
    tokens = normalized.split(' ')
    if not tokens or len(tokens) > contract['limits']['tokens']:
        return None, None, 'invalidInput'
    return normalized, tokens, None


def feature_set(tokens: list[str]) -> set[str]:
    return set(tokens) | {tokens[index] + ' ' + tokens[index + 1] for index in range(len(tokens) - 1)}


def _sum(values: Any) -> float:
    total = 0.0
    for value in values:
        total += value
    return total


def inspect_input(text: Any, known_content: set[str], contract: dict[str, Any]) -> dict[str, Any]:
    normalized, tokens, reason = normalize(text, contract)
    result: dict[str, Any] = {'vetoReason': reason, 'normalized': normalized, 'tokens': tokens, 'features': None,
                              'scores': None, 'topIntent': None, 'topScore': None, 'margin': None,
                              'similarity': None, 'accepted': False, 'canonicalQuery': None, 'screen': None}
    if reason:
        return result
    assert tokens is not None
    policy = contract['rejectionPolicy']
    token_set = set(tokens)
    if token_set & set(policy['negationTokens']) or any(token.endswith(policy['negationTokenSuffix']) for token in tokens):
        result['vetoReason'] = 'negation'
    elif token_set & set(policy['compositionTokens']):
        result['vetoReason'] = 'composition'
    elif token_set & set(policy['unsupportedConstraintTokens']):
        result['vetoReason'] = 'unsupportedConstraint'
    else:
        anchors = 0
        for sequence in policy['canonicalAnchorTokenSequences']:
            if any(tokens[index:index + len(sequence)] == sequence for index in range(len(tokens) - len(sequence) + 1)):
                anchors += 1
        if anchors >= 2:
            result['vetoReason'] = 'multipleCanonicalAnchors'
        else:
            known = known_content
            stopwords = set(policy['requestStopwords'])
            if any(token not in known and token not in stopwords for token in tokens) or not token_set - stopwords:
                result['vetoReason'] = 'unknownContent'
    if result['vetoReason']:
        return result
    return result


def infer(text: Any, model: dict[str, Any], contract: dict[str, Any], thresholds: dict[str, float] | None = None) -> dict[str, Any]:
    result = inspect_input(text, set(model['knownContentTokens']), contract)
    if result['vetoReason']:
        return result
    tokens = result['tokens']
    present = feature_set(tokens)
    sparse = [[index, model['idf'][index]] for index, feature in enumerate(model['vocabulary']) if feature in present]
    norm = math.sqrt(_sum(value * value for _, value in sparse))
    if not norm:
        result['vetoReason'] = 'emptyFeatures'
        return result
    sparse = [[index, value / norm] for index, value in sparse]
    result['features'] = sparse
    logits = []
    for row, intercept in zip(model['coefficients'], model['intercepts'], strict=True):
        value = 0.0
        for index, feature in sparse:
            value += row[index] * feature
        logits.append(float(intercept) + value)
    largest = max(logits)
    exps = [math.exp(value - largest) for value in logits]
    denominator = _sum(exps)
    scores = [value / denominator for value in exps]
    top = max(range(6), key=lambda index: scores[index])
    margin = scores[top] - max(value for index, value in enumerate(scores) if index != top)
    similarity = _sum(model['centroids'][top][index] * value for index, value in sparse)
    similarity = max(-1.0, min(1.0, similarity))
    result.update(scores=scores, topIntent=model['classOrder'][top], topScore=scores[top], margin=margin, similarity=similarity)
    chosen = model['thresholds'] if thresholds is None else thresholds
    if scores[top] < chosen['minScore'] or margin < chosen['minMargin'] or similarity < chosen['minSimilarity']:
        result['vetoReason'] = 'modelThresholds'
        return result
    mapping = contract['canonicalMappings'][top]
    defaults = contract['screenDefaults']
    result.update(accepted=True, canonicalQuery=mapping['query'], screen={
        'sector': defaults['sector'], 'currency': defaults['currency'],
        'filters': [{'metric': mapping['metric'], 'operator': mapping['operator'], 'value': mapping['value'], 'currency': defaults['filterCurrency']}],
        'includeStale': defaults['includeStale'], 'sortBy': defaults['sortBy'], 'direction': defaults['direction']})
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, default=HERE / 'model.json')
    parser.add_argument('--contract', type=Path, default=HERE / 'training-contract.json')
    parser.add_argument('--text', required=True)
    args = parser.parse_args()
    try:
        model, contract = load_model(args.model, args.contract)
        print(json.dumps(infer(args.text, model, contract), ensure_ascii=True, allow_nan=False, sort_keys=True))
    except (ValueError, OSError, UnicodeError, RecursionError) as error:
        parser.exit(2, f'Inference unavailable: {error}\n')


if __name__ == '__main__':
    main()
