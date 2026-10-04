"""Train the frozen local experiment using training/development files only.

No held-out input option exists. Development failure remains a failure; this
script exports diagnostic evidence without importing it into the product.
"""
from __future__ import annotations

import argparse
from collections import Counter
from fractions import Fraction
import itertools
import json
import math
import os
from pathlib import Path
import platform
import re
import sys
import warnings
from typing import Any

from reference import feature_set, infer, inspect_input, normalize, read_json, sha256, validate_model

HERE = Path(__file__).resolve().parent


def select_thresholds(candidates: list[dict[str, Any]], class_counts: list[int]) -> tuple[dict[str, Any] | None, str]:
    eligible = [candidate for candidate in candidates if candidate['wrongAccepted'] == 0 and candidate['unsupportedAccepted'] == 0]
    if not eligible:
        return None, 'noEligibleThresholds'
    ready = [candidate for candidate in eligible if all(4 * count >= 3 * total for count, total in zip(candidate['acceptedPerClass'], class_counts, strict=True))]

    def rank(candidate: dict[str, Any]) -> tuple[Any, ...]:
        thresholds = candidate['thresholds']
        return (sum(candidate['acceptedPerClass']), min(Fraction(count, total) for count, total in zip(candidate['acceptedPerClass'], class_counts, strict=True)),
                thresholds['minScore'], thresholds['minMargin'], thresholds['minSimilarity'])

    return max(ready or eligible, key=rank), 'ready' if ready else 'notReady'


def validate_corpus(value: Any, split: str, contract: dict[str, Any]) -> dict[str, Any]:
    schema = contract['corpusSchema']
    if (not isinstance(value, dict) or set(value) != set(schema['rootKeys'])
            or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1
            or value['split'] != split or value['provenance'] != schema['provenance']):
        raise ValueError('Unexpected corpus metadata.')
    examples = value['examples']
    if not isinstance(examples, list) or not 1 <= len(examples) <= contract['limits']['maximumCorpusExamples']:
        raise ValueError('Invalid corpus example count.')
    identifiers: set[str] = set()
    raw_texts: set[str] = set()
    normalized_texts: set[str] = set()
    for example in examples:
        if not isinstance(example, dict) or 'intent' not in example:
            raise ValueError('Malformed corpus example.')
        supported = example['intent'] is not None
        keys = schema['supportedExampleKeys'] if supported else schema['unsupportedExampleKeys']
        if set(example) != set(keys):
            raise ValueError('Unexpected example fields.')
        for key in ('id', 'family'):
            if not isinstance(example[key], str) or not re.fullmatch(schema['idFamilyRegex'], example[key], flags=re.ASCII):
                raise ValueError('Invalid example identifier/family.')
        if example['id'] in identifiers or not isinstance(example['text'], str) or example['text'] in raw_texts:
            raise ValueError('Duplicate ID/text or non-string text.')
        identifiers.add(example['id'])
        raw_texts.add(example['text'])
        normalized, _, reason = normalize(example['text'], contract)
        if supported:
            if example['intent'] not in contract['classOrder'] or reason:
                raise ValueError('Invalid supported intent or raw input.')
            if normalized in normalized_texts:
                raise ValueError('Duplicate normalized supported example.')
            normalized_texts.add(normalized)
        else:
            if split == 'training' or not isinstance(example['reason'], str) or not example['reason'] or len(example['reason']) > schema['reasonMaxCharacters']:
                raise ValueError('Invalid unsupported example.')
    return value


def corpus_counts(corpus: dict[str, Any], order: list[str]) -> dict[str, Any]:
    counts = Counter(example['intent'] for example in corpus['examples'])
    return {'total': len(corpus['examples']), 'supported': sum(counts[intent] for intent in order), 'unsupported': counts[None],
            'intents': {intent: counts[intent] for intent in order}, 'families': len({example['family'] for example in corpus['examples']})}


def audit_corpora(training: dict[str, Any], development: dict[str, Any], contract: dict[str, Any]) -> dict[str, Any]:
    train_ids = {example['id'] for example in training['examples']}
    dev_ids = {example['id'] for example in development['examples']}
    if train_ids & dev_ids:
        raise ValueError('Example IDs must be unique across splits.')
    train_families = {example['family'] for example in training['examples']}
    dev_families = {example['family'] for example in development['examples']}
    if train_families & dev_families:
        raise ValueError('A family belongs to both splits.')
    stopwords = set(contract['rejectionPolicy']['requestStopwords'])
    duplicates = []
    near = []
    for a in training['examples']:
        a_normalized, a_tokens, _ = normalize(a['text'], contract)
        assert a_tokens is not None
        for b in development['examples']:
            b_normalized, b_tokens, invalid = normalize(b['text'], contract)
            if invalid:
                continue
            assert b_tokens is not None
            if a_normalized == b_normalized:
                duplicates.append({'trainingId': a['id'], 'developmentId': b['id']})
            for feature_kind in ('tokens', 'bigrams'):
                left = set(a_tokens) if feature_kind == 'tokens' else {a_tokens[i] + ' ' + a_tokens[i + 1] for i in range(len(a_tokens) - 1)}
                right = set(b_tokens) if feature_kind == 'tokens' else {b_tokens[i] + ' ' + b_tokens[i + 1] for i in range(len(b_tokens) - 1)}
                intersection = left & right
                union = left | right
                if not union or not any(set(feature.split(' ')) - stopwords for feature in intersection):
                    continue
                if 5 * len(intersection) >= 4 * len(union):
                    near.append({'trainingId': a['id'], 'developmentId': b['id'], 'kind': feature_kind,
                                 'intersection': len(intersection), 'union': len(union), 'disposition': 'REQUIRES_MANUAL_REVIEW_BEFORE_FIT'})
    if duplicates:
        raise ValueError('Exact normalized cross-split duplicates must be replaced before fitting.')
    if near:
        raise ValueError('Near-duplicate pairs require documented pre-fit review; no automatic fit.')
    return {'normalizedDuplicatePairs': duplicates, 'nearDuplicatePairs': near,
            'familyOverlap': [], 'manualReview': 'Independent reviewer cleared construction independence and strict labels before fitting; no normalized duplicates or remaining flagged overlap candidates. This computational check alone does not certify semantic independence.',
            'preOutcomeCorrections': {
                'constructionIndependenceDevelopmentEdits': 13, 'strictNetLossTrainingEdits': 3,
                'strictNetLossDevelopmentEdits': 1, 'emptyUnsupportedReplacement': 1,
                'fixedPolicyEligibilityTrainingEdits': 6,
                'fixedPolicySanityAttemptsBeforeEligibilityCorrection': 2,
                'developmentScoresObservedBeforeCorrections': False,
                'policyChanged': False,
                'note': 'Both numeric export-sanity attempts stopped on the same deterministic training-word veto before artifact publication or development inference. Eligibility is now checked across all training texts before numeric imports/fitting. No correction used learned scores.'}}


def _zero(value: Any) -> Any:
    if isinstance(value, float) and value == 0:
        return 0.0
    if isinstance(value, dict):
        return {key: _zero(child) for key, child in value.items()}
    if isinstance(value, list):
        return [_zero(child) for child in value]
    return value


def encoded(value: Any) -> bytes:
    return (json.dumps(_zero(value), ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')


def write_json(path: Path, value: Any) -> None:
    if path.name.startswith('heldout-'):
        raise ValueError('Cannot write held-out artifacts.')
    path.write_bytes(encoded(value))


def training_policy_conflicts(corpus: dict[str, Any], contract: dict[str, Any]) -> list[dict[str, str]]:
    known: set[str] = set()
    stopwords = set(contract['rejectionPolicy']['requestStopwords'])
    for example in corpus['examples']:
        _, tokens, reason = normalize(example['text'], contract)
        if reason is None and tokens is not None:
            known.update(set(tokens) - stopwords)
    conflicts = []
    for example in corpus['examples']:
        result = inspect_input(example['text'], known, contract)
        if result['vetoReason']:
            conflicts.append({'id': example['id'], 'vetoReason': result['vetoReason']})
    return conflicts


def fit(training: dict[str, Any], contract: dict[str, Any], contract_path: Path, training_path: Path, development_path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    # Pure policy checks run before numeric imports and model fitting.
    conflicts = training_policy_conflicts(training, contract)
    if conflicts:
        raise ValueError(f'Training inputs violate frozen eligibility: {conflicts}')
    # Limits and version checks run before numeric imports. No network or install.
    for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
        os.environ[variable] = '1'
    import numpy as np
    import scipy
    from scipy.sparse import csr_matrix
    import sklearn
    from sklearn.exceptions import ConvergenceWarning
    from sklearn.linear_model import LogisticRegression
    actual = {'python': platform.python_version(), 'scikitLearn': sklearn.__version__, 'numpy': np.__version__, 'scipy': scipy.__version__}
    if actual != contract['training']['dependencies']:
        raise ValueError(f'Installed dependency versions differ from contract: {actual}')
    order = contract['classOrder']
    texts = training['examples']
    counts = Counter(example['intent'] for example in texts)
    if min(counts[intent] for intent in order) < contract['training']['minimumSupportedPerClass'] or len({counts[intent] for intent in order}) != 1:
        raise ValueError('Training classes must meet equal supported counts.')
    rows = []
    known: set[str] = set()
    frequencies: Counter[str] = Counter()
    stopwords = set(contract['rejectionPolicy']['requestStopwords'])
    for example in texts:
        _, tokens, error = normalize(example['text'], contract)
        if error or tokens is None:
            raise ValueError('Training text violates normalization.')
        known.update(set(tokens) - stopwords)
        present = feature_set(tokens)
        rows.append(present)
        frequencies.update(present)
    vocabulary = sorted(sorted(frequencies, key=lambda feature: (-frequencies[feature], feature))[:contract['limits']['vocabularyFeatures']])
    columns = {feature: index for index, feature in enumerate(vocabulary)}
    idf = [1 + math.log((1 + len(texts)) / (1 + frequencies[feature])) for feature in vocabulary]
    values = []
    row_indices = []
    column_indices = []
    for row_index, present in enumerate(rows):
        selected = sorted(columns[feature] for feature in present if feature in columns)
        norm = math.sqrt(sum(idf[index] * idf[index] for index in selected))
        if not norm:
            raise ValueError('Training produced an empty feature row.')
        for index in selected:
            values.append(idf[index] / norm)
            row_indices.append(row_index)
            column_indices.append(index)
    matrix = csr_matrix((values, (row_indices, column_indices)), shape=(len(rows), len(vocabulary)), dtype=np.float64)
    parameters = contract['training']['classifier']
    classifier = LogisticRegression(C=parameters['C'], solver=parameters['solver'], max_iter=parameters['maxIter'], tol=parameters['tol'],
                                    fit_intercept=parameters['fitIntercept'], class_weight=parameters['classWeight'], random_state=contract['seed'])
    labels = np.array([example['intent'] for example in texts])
    with warnings.catch_warnings():
        warnings.simplefilter('error', ConvergenceWarning)
        classifier.fit(matrix, labels)
    indices = [list(classifier.classes_).index(intent) for intent in order]
    coefficients = classifier.coef_[indices].tolist()
    intercepts = classifier.intercept_[indices].tolist()
    centroids = []
    for intent in order:
        mean = np.asarray(matrix[labels == intent].mean(axis=0)).reshape(-1)
        norm = float(np.sqrt(np.sum(mean * mean)))
        if not norm:
            raise ValueError('Empty class centroid.')
        centroids.append((mean / norm).tolist())
    model = {key: contract[key] for key in ('classOrder', 'canonicalMappings', 'screenDefaults', 'normalizer', 'rejectionPolicy', 'limits')}
    model.update(schemaVersion=1, contractSha256=sha256(contract_path), trainingSha256=sha256(training_path), developmentSha256=sha256(development_path),
                 dependencies=actual, knownContentTokens=sorted(known), vocabulary=vocabulary, idf=idf, coefficients=coefficients, intercepts=intercepts, centroids=centroids,
                 thresholds={name: contract['thresholdSelection'][name + 'Grid'][0] for name in ('minScore', 'minMargin', 'minSimilarity')})
    model = validate_model(model, contract, model['contractSha256'])
    if len(encoded(model)) > contract['limits']['artifactBytes']:
        raise ValueError('Artifact exceeds the frozen byte bound.')
    # Confirm exported inference uses the actual fit, not a shortcut or canned map.
    max_score_error = 0.0
    sklearn_scores = classifier.predict_proba(matrix)[:, indices]
    for example, expected in zip(texts, sklearn_scores, strict=True):
        observed = infer(example['text'], model, contract)
        if observed['scores'] is None:
            raise ValueError(f"Supported training example {example['id']} hit deterministic veto {observed['vetoReason']}.")
        max_score_error = max(max_score_error, max(abs(a - float(b)) for a, b in zip(observed['scores'], expected, strict=True)))
    if max_score_error > contract['inference']['floatingParityAbsoluteTolerance']:
        raise ValueError('Exported reference differs from fitted classifier.')
    return model, {'iterations': classifier.n_iter_.tolist(), 'converged': True, 'vocabularyFeatures': len(vocabulary),
                   'trainingRows': len(texts), 'exportedFitScoreMaxAbsoluteError': max_score_error}


def evaluate_development(model: dict[str, Any], development: dict[str, Any], contract: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    examples = development['examples']
    counts = Counter(example['intent'] for example in examples)
    minimum = contract['corpusSchema']['developmentMinimum']
    order = contract['classOrder']
    if counts[None] < minimum['unsupportedTotal'] or min(counts[intent] for intent in order) < minimum['supportedPerClass']:
        raise ValueError('Development corpus falls below declared minimum counts.')
    cache = [infer(example['text'], model, contract) for example in examples]
    candidates = []
    grid = contract['thresholdSelection']
    for score, margin, similarity in itertools.product(grid['minScoreGrid'], grid['minMarginGrid'], grid['minSimilarityGrid']):
        candidate = {'thresholds': {'minScore': score, 'minMargin': margin, 'minSimilarity': similarity},
                     'acceptedPerClass': [0] * 6, 'wrongAccepted': 0, 'unsupportedAccepted': 0}
        for example, result in zip(examples, cache, strict=True):
            accepted = (result['scores'] is not None and result['topScore'] >= score and result['margin'] >= margin and result['similarity'] >= similarity)
            if not accepted:
                continue
            if example['intent'] is None:
                candidate['unsupportedAccepted'] += 1
            else:
                candidate['acceptedPerClass'][order.index(example['intent'])] += 1
                if result['topIntent'] != example['intent']:
                    candidate['wrongAccepted'] += 1
        candidates.append(candidate)
    selected, status = select_thresholds(candidates, [counts[intent] for intent in order])
    if selected is not None:
        model['thresholds'] = selected['thresholds']
    rows = []
    per_intent = {intent: {'total': counts[intent], 'accepted': 0, 'correct': 0, 'incorrect': 0, 'abstained': 0} for intent in order}
    unsupported_reasons: dict[str, dict[str, int]] = {}
    veto_counts: Counter[str] = Counter()
    confusion = {intent: {predicted: 0 for predicted in order} for intent in order}
    for example in sorted(examples, key=lambda example: example['id']):
        result = infer(example['text'], model, contract)
        if selected is None:
            result.update(accepted=False, canonicalQuery=None, screen=None, vetoReason='modelThresholds')
        rows.append({'id': example['id'], 'text': example['text'], 'expectedIntent': example['intent'], **result})
        veto_counts[result['vetoReason'] or 'accepted'] += 1
        if example['intent'] is not None:
            summary = per_intent[example['intent']]
            summary['accepted' if result['accepted'] else 'abstained'] += 1
            if result['accepted']:
                summary['correct' if result['topIntent'] == example['intent'] else 'incorrect'] += 1
                confusion[example['intent']][result['topIntent']] += 1
        else:
            summary = unsupported_reasons.setdefault(example['reason'], {'total': 0, 'accepted': 0, 'abstained': 0})
            summary['total'] += 1
            summary['accepted' if result['accepted'] else 'abstained'] += 1
    report = {'status': status, 'selected': selected, 'grid': candidates, 'perIntent': per_intent, 'unsupportedByReason': unsupported_reasons,
              'vetoCounts': dict(sorted(veto_counts.items())), 'acceptedConfusion': confusion, 'parityVectors': rows}
    return model, report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--contract', type=Path, default=HERE / 'training-contract.json')
    parser.add_argument('--training', type=Path, default=HERE / 'training.json')
    parser.add_argument('--development', type=Path, default=HERE / 'development.json')
    parser.add_argument('--model-output', type=Path, default=HERE / 'model.json')
    parser.add_argument('--report-output', type=Path, default=HERE / 'development-results.json')
    args = parser.parse_args()
    try:
        contract = read_json(args.contract)
        # Restart before numeric imports so Python hash and BLAS environment
        # settings are part of the process from its first import.
        expected_env = {'PYTHONHASHSEED': str(contract['seed']), 'OMP_NUM_THREADS': '1', 'OPENBLAS_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1'}
        if any(os.environ.get(key) != value for key, value in expected_env.items()):
            environment = dict(os.environ)
            environment.update(expected_env)
            os.execve(sys.executable, [sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]], environment)
        training = validate_corpus(read_json(args.training, 4194304), 'training', contract)
        development = validate_corpus(read_json(args.development, 4194304), 'development', contract)
        audit = audit_corpora(training, development, contract)
        model, convergence = fit(training, contract, args.contract, args.training, args.development)
        model, evaluation = evaluate_development(model, development, contract)
        model_bytes = encoded(model)
        if len(model_bytes) > contract['limits']['artifactBytes']:
            raise ValueError('Final artifact exceeds byte bound.')
        import hashlib
        report = {'schemaVersion': 1, 'contractSha256': sha256(args.contract), 'trainingSha256': sha256(args.training), 'developmentSha256': sha256(args.development),
                  'artifactSha256': hashlib.sha256(model_bytes).hexdigest(), 'dependencies': model['dependencies'], 'seed': contract['seed'],
                  'corpusCounts': {'training': corpus_counts(training, contract['classOrder']), 'development': corpus_counts(development, contract['classOrder'])},
                  'audit': audit, 'fit': convergence, 'artifactBytes': len(model_bytes), **evaluation,
                  'limitations': 'Development evidence only. No held-out files or outcomes read. No product integration or general language/financial analysis claim.'}
        if evaluation['status'] != 'noEligibleThresholds':
            args.model_output.write_bytes(model_bytes)
        write_json(args.report_output, report)
        print(json.dumps({'status': report['status'], 'selected': report['selected'], 'perIntent': report['perIntent'],
                          'vetoCounts': report['vetoCounts'], 'artifactBytes': report['artifactBytes'], 'artifactSha256': report['artifactSha256']}, sort_keys=True))
    except (ValueError, OSError, UnicodeError, RecursionError, Warning) as error:
        parser.exit(2, f'Training failed without release: {error}\n')


if __name__ == '__main__':
    main()
