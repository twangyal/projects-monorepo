"""Strict, deterministic challenge transitions and private-record validation."""
from copy import deepcopy
import ipaddress
import json
import math
import re
import secrets
from urllib.parse import urlsplit


class DomainError(Exception):
    """A bounded public error, safe to serialize without private input values."""

    def __init__(self, code: str, message: str, status: int):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


MAX_BYTES = 1024 * 1024
SAFE_INTEGER = 2**53 - 1
YEAR_MS = 365 * 86400000
ID = re.compile(r'[0-9a-f]{32}\Z')
TOKEN = re.compile(r'[0-9a-f]{64}\Z')
PARTIES = ('proposer', 'opponent')
ROLES = (*PARTIES, 'arbiter')
TERMINAL = ('resolved', 'voided', 'declined', 'withdrawn')
STAKES = ('bragging-rights', 'make-a-drink', 'pick-a-movie', 'do-the-dishes')
ACTION_FIELDS = {
    'terms': 'revision terms', 'invite': 'revision seat', 'accept': 'revision termsVersion',
    'decline': 'revision reason', 'withdraw': 'revision reason',
    'evidence': 'revision text url', 'result': 'revision outcome reason',
    'result/respond': 'revision proposalId accept reason', 'void': 'revision reason',
    'void/confirm': 'revision proposalId', 'arbiter/nominate': 'revision name reason',
    'arbiter/respond': 'revision nominationId accept reason',
    'arbiter/withdraw': 'revision nominationId reason', 'arbiter/decide': 'revision outcome reason',
}


def require(condition, message, code='invalid_request', status=400):
    if not condition:
        raise DomainError(code, message, status)


def fields(value, keys, label='Object'):
    require(type(value) is dict and set(value) == set(keys.split()),
            f'{label} must contain exactly the required fields.')
    return value


def integer(value, label='Value', minimum=0, maximum=SAFE_INTEGER):
    require(type(value) is int and minimum <= value <= maximum,
            f'{label} must be a bounded nonnegative integer.')
    return value


def identifier(value):
    require(type(value) is str and ID.fullmatch(value) is not None, 'Use a valid challenge or proposal ID.')
    return value


def text(value, maximum, label='Text', *, trim=False, empty=False):
    require(type(value) is str, f'{label} must be text.')
    value = value.strip() if trim else value
    require((empty or bool(value.strip())) and len(value) <= maximum,
            f'{label} must contain {0 if empty else 1}–{maximum} characters.')
    require(not any((ord(char) < 32 and char not in '\n\r\t') or ord(char) == 127 for char in value),
            f'{label} contains unsupported control characters.')
    try:
        value.encode('utf-8')
    except UnicodeError:
        raise DomainError('invalid_request', f'{label} must contain valid Unicode.', 400) from None
    return value


def choice(value, options, label='Value'):
    require(type(value) is str and value in options, f'{label} is not supported.')
    return value


def validate_url(value):
    if value is None:
        return None
    value = text(value, 1024, 'Evidence URL')
    invalid = 'Use a credential-free HTTPS DNS link without ports, queries or control characters.'
    require(not any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value)
            and '\\' not in value and '?' not in value, invalid)
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ''
        host.encode('ascii')
        valid = (parsed.scheme == 'https' and parsed.netloc.lower() == host
                 and ':' not in parsed.netloc and '@' not in parsed.netloc
                 and parsed.username is None and parsed.password is None
                 and 1 <= len(host) <= 253)
    except (ValueError, UnicodeError):
        valid = False
        host = ''
    require(valid, invalid)
    labels = host.split('.')
    require(len(labels) >= 2 and all(re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', part) for part in labels), invalid)
    require(re.search(r'[A-Za-z]', labels[-1]) is not None
            and re.fullmatch(r'0[xX][0-9A-Fa-f]+', labels[-1]) is None
            and labels[-1] not in ('localhost', 'local', 'internal', 'test'), invalid)
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        require(False, invalid)
    require(re.search(r'%(?![0-9A-Fa-f]{2})', value) is None, invalid)
    require(all(int(pair, 16) >= 32 and int(pair, 16) != 127
                for pair in re.findall(r'%([0-9A-Fa-f]{2})', value)), invalid)
    return value


def validate_terms(value, now=None):
    fields(value, 'title description successCriteria evidenceRule stake deadline', 'Terms')
    deadline = integer(value['deadline'], 'Deadline')
    if now is not None:
        require(now < deadline <= min(SAFE_INTEGER, now + YEAR_MS),
                'Choose a future deadline no more than 365 days away.')
    return dict(title=text(value['title'], 100, 'Title', trim=True),
                description=text(value['description'], 500, 'Description'),
                successCriteria=text(value['successCriteria'], 500, 'Success criteria'),
                evidenceRule=text(value['evidenceRule'], 300, 'Evidence rule'),
                stake=choice(value['stake'], STAKES, 'Stake'), deadline=deadline)


def encode_json(value):
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'), sort_keys=True)
        require(len(encoded.encode('utf-8')) <= MAX_BYTES, 'Challenge record exceeds the 1 MiB limit.', 'limit', 409)
        return encoded
    except (UnicodeError, ValueError, TypeError, RecursionError):
        raise DomainError('invalid_request', 'Supply valid bounded JSON data.', 400) from None


def parse_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON fields are not supported.')
            result[key] = value
        return result

    def constant(_):
        raise DomainError('invalid_request', 'Nonfinite JSON numbers are not supported.', 400)

    try:
        require(type(raw) is str and len(raw.encode('utf-8')) <= MAX_BYTES, 'JSON exceeds the 1 MiB limit.')
        value = json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeError, RecursionError):
        raise DomainError('invalid_request', 'Supply valid UTF-8 JSON.', 400) from None
    stack = [(value, 0)]
    while stack:
        item, depth = stack.pop()
        require(depth <= 32, 'JSON is nested too deeply.')
        if type(item) is dict:
            stack.extend((child, depth + 1) for child in item.values())
        elif type(item) is list:
            stack.extend((child, depth + 1) for child in item)
        elif type(item) is float:
            require(math.isfinite(item), 'Nonfinite JSON numbers are not supported.')
    return value


def timestamp(clock):
    value = clock()
    require(type(value) in (int, float) and 0 <= value <= SAFE_INTEGER / 1000 and math.isfinite(value),
            'The service clock is outside supported bounds.', 'internal_error', 500)
    return integer(int(value * 1000), 'Server time')


def _event(state, actor, kind, details, now):
    state['revision'] += 1
    state['events'].append(dict(seq=state['revision'], at=now, actor=actor, kind=kind, details=deepcopy(details)))


def create_state(challenge_id, payload, now):
    fields(payload, 'name terms', 'Creation')
    name = text(payload['name'], 40, 'Name', trim=True)
    terms = validate_terms(payload['terms'], now)
    state = dict(id=identifier(challenge_id), revision=0, status='proposed', termsVersion=1,
                 terms=terms, acceptedAt=None, createdAt=integer(now, 'Server time'),
                 profiles=dict(proposer=dict(name=name), opponent=None, arbiter=None),
                 evidence=[], events=[], resultProposal=None, voidProposal=None,
                 arbiterNomination=None, resolution=None,
                 limitsUsed=dict(termsEdits=0, resultProposals=0, arbiterNominations=0,
                                 opponentInvites=1, arbiterInvites=0))
    _event(state, 'proposer', 'created', dict(name=name, terms=terms, termsVersion=1), now)
    return state


def _role(role, allowed):
    require(role in allowed, 'This seat cannot perform that action.', 'forbidden', 403)


def _state(state, allowed):
    require(state['status'] in allowed, 'That action is unavailable in the current challenge state.', 'conflict', 409)


def _quota(state, key, maximum):
    require(state['limitsUsed'][key] < maximum, 'The allowance for this action has been used.', 'limit', 409)
    state['limitsUsed'][key] += 1


def _entity_id(state, supplied):
    value = identifier(supplied) if supplied is not None else secrets.token_hex(16)
    used = {state['id']}
    for event in state['events']:
        for key in ('evidence', 'proposal', 'nomination'):
            entry = event['details'].get(key)
            if entry is not None:
                used.add(entry['id'])
    require(value not in used, 'Generated record ID collision; retry the action.', 'internal_error', 500)
    return value


def _resolution(state, outcome, method, actor, reason, now, proposal_id=None):
    state['status'] = 'voided' if outcome == 'void' else 'resolved'
    state['resolution'] = dict(outcome=outcome, method=method, by=actor, reason=reason,
                               decidedAt=now, proposalId=proposal_id)
    state['resultProposal'] = state['voidProposal'] = None


def apply_claim(state, seat, name, now):
    """Mutate a detached/transaction-local state after invitation authentication."""
    name = text(name, 40, 'Name', trim=True)
    require(state['profiles'][seat] is None, 'That seat is already claimed.', 'conflict', 409)
    if seat == 'opponent':
        _state(state, ('proposed',))
        details = dict(name=name)
    else:
        _state(state, ('disputed',))
        nomination = state['arbiterNomination']
        require(nomination is not None and nomination['status'] == 'approved', 'The arbiter nomination is not approved.', 'conflict', 409)
        require(name == nomination['name'], 'Use the exact name mutually nominated for this seat.')
        details = dict(nominationId=nomination['id'], name=name)
    state['profiles'][seat] = dict(name=name)
    _event(state, seat, seat + '_joined', details, now)


def apply_command(state, role, action, payload, now, entity_id=None):
    """Apply one validated command to transaction-local state, appending one event."""
    require(type(action) is str and action in ACTION_FIELDS, 'Unknown challenge command.')
    fields(payload, ACTION_FIELDS[action], 'Command')
    revision = integer(payload['revision'], 'Revision', 1)
    require(revision == state['revision'], 'The challenge changed. Refresh and review before trying again.', 'conflict', 409)
    require(state['status'] not in TERMINAL, 'This challenge has ended; its record is immutable.', 'conflict', 409)
    _role(role, ('arbiter',) if action == 'arbiter/decide' else ('proposer',) if action in ('terms', 'withdraw') else ('opponent',) if action in ('accept', 'decline') else PARTIES)
    details = {}
    if action == 'terms':
        _state(state, ('proposed',))
        terms = validate_terms(payload['terms'], now)
        _quota(state, 'termsEdits', 10)
        state['termsVersion'] += 1
        state['terms'] = terms
        kind, details = 'terms_edited', dict(terms=terms, termsVersion=state['termsVersion'])
    elif action == 'invite':
        seat = choice(payload['seat'], ('opponent', 'arbiter'), 'Invitation seat')
        require(state['profiles'][seat] is None, 'That seat is already claimed.', 'conflict', 409)
        if seat == 'opponent':
            _role(role, ('proposer',))
            _state(state, ('proposed',))
        else:
            _state(state, ('disputed',))
            nomination = state['arbiterNomination']
            require(nomination is not None and nomination['status'] == 'approved', 'Both parties must approve this arbiter first.', 'conflict', 409)
        _quota(state, seat + 'Invites', 10)
        kind, details = 'invite_issued', dict(seat=seat)
    elif action == 'accept':
        _state(state, ('proposed',))
        terms_version = integer(payload['termsVersion'], 'Terms version', 1)
        require(terms_version == state['termsVersion'], 'The terms changed; review the current version.', 'conflict', 409)
        require(now < state['terms']['deadline'], 'Acceptance is closed at the deadline.', 'conflict', 409)
        state['status'], state['acceptedAt'] = 'active', now
        kind, details = 'accepted', dict(termsVersion=terms_version)
    elif action in ('decline', 'withdraw'):
        _state(state, ('proposed',))
        reason = text(payload['reason'], 500, 'Reason')
        state['status'] = kind = 'declined' if action == 'decline' else 'withdrawn'
        details = dict(reason=reason)
    else:
        _state(state, ('active', 'disputed'))
        if action == 'evidence':
            require(len(state['evidence']) < 40, 'The 40-entry evidence allowance has been used.', 'limit', 409)
            evidence = dict(id=_entity_id(state, entity_id), author=role,
                            text=text(payload['text'], 1000, 'Evidence'), url=validate_url(payload['url']),
                            createdAt=now, late=now >= state['terms']['deadline'])
            state['evidence'].append(evidence)
            kind, details = 'evidence_added', dict(evidence=evidence)
        elif action == 'result':
            require(state['resultProposal'] is None or state['resultProposal']['status'] != 'pending', 'Respond to the pending result before proposing another.', 'conflict', 409)
            proposal = dict(id=_entity_id(state, entity_id), proposedBy=role,
                            outcome=choice(payload['outcome'], PARTIES, 'Result outcome'),
                            reason=text(payload['reason'], 500, 'Reason'), status='pending', createdAt=now, respondedAt=None)
            _quota(state, 'resultProposals', 10)
            state['resultProposal'] = proposal
            kind, details = 'result_proposed', dict(proposal=proposal)
        elif action == 'result/respond':
            proposal_id = identifier(payload['proposalId'])
            proposal = state['resultProposal']
            require(proposal is not None and proposal['status'] == 'pending' and proposal['id'] == proposal_id, 'That result proposal is no longer pending.', 'conflict', 409)
            _role(role, tuple(party for party in PARTIES if party != proposal['proposedBy']))
            accepted = payload['accept']
            require(type(accepted) is bool, 'Consent must be true or false.')
            reason = text(payload['reason'], 500, 'Reason', empty=accepted)
            if accepted:
                _resolution(state, proposal['outcome'], 'mutual', role, proposal['reason'], now, proposal_id)
            else:
                proposal['status'], proposal['respondedAt'], state['status'] = 'rejected', now, 'disputed'
            kind, details = 'result_responded', dict(proposalId=proposal_id, accept=accepted, reason=reason)
        elif action == 'void':
            require(state['voidProposal'] is None, 'The existing lifetime void offer cannot be replaced or withdrawn.', 'conflict', 409)
            proposal = dict(id=_entity_id(state, entity_id), proposedBy=role, reason=text(payload['reason'], 500, 'Reason'), createdAt=now)
            state['voidProposal'] = proposal
            kind, details = 'void_offered', dict(proposal=proposal)
        elif action == 'void/confirm':
            proposal_id = identifier(payload['proposalId'])
            proposal = state['voidProposal']
            require(proposal is not None and proposal['id'] == proposal_id, 'That void offer is not available.', 'conflict', 409)
            _role(role, tuple(party for party in PARTIES if party != proposal['proposedBy']))
            _resolution(state, 'void', 'mutual', role, proposal['reason'], now, proposal_id)
            kind, details = 'void_confirmed', dict(proposalId=proposal_id)
        else:
            _state(state, ('disputed',))
            nomination = state['arbiterNomination']
            if action == 'arbiter/decide':
                require(state['profiles']['arbiter'] is not None and nomination is not None and nomination['status'] == 'approved', 'An approved arbiter must claim the seat before deciding.', 'conflict', 409)
                outcome = choice(payload['outcome'], (*PARTIES, 'void'), 'Decision outcome')
                reason = text(payload['reason'], 500, 'Reason')
                _resolution(state, outcome, 'arbiter', role, reason, now)
                kind, details = 'arbiter_decided', dict(outcome=outcome, reason=reason)
            else:
                require(state['profiles']['arbiter'] is None, 'The claimed arbiter appointment cannot be revoked or replaced.', 'conflict', 409)
                if action == 'arbiter/nominate':
                    require(nomination is None or nomination['status'] in ('rejected', 'withdrawn'), 'Respond to or withdraw the current nomination first.', 'conflict', 409)
                    nomination = dict(id=_entity_id(state, entity_id), name=text(payload['name'], 40, 'Name', trim=True), proposedBy=role,
                                      reason=text(payload['reason'], 500, 'Reason'), status='pending', createdAt=now, respondedAt=None)
                    _quota(state, 'arbiterNominations', 5)
                    state['arbiterNomination'] = nomination
                    kind, details = 'arbiter_nominated', dict(nomination=nomination)
                else:
                    nomination_id = identifier(payload['nominationId'])
                    require(nomination is not None and nomination['id'] == nomination_id, 'That arbiter nomination is no longer current.', 'conflict', 409)
                    if action == 'arbiter/respond':
                        require(nomination['status'] == 'pending', 'That nomination is no longer pending.', 'conflict', 409)
                        _role(role, tuple(party for party in PARTIES if party != nomination['proposedBy']))
                        accepted = payload['accept']
                        require(type(accepted) is bool, 'Consent must be true or false.')
                        reason = text(payload['reason'], 500, 'Reason', empty=accepted)
                        nomination['status'] = 'approved' if accepted else 'rejected'
                        kind, details = 'arbiter_responded', dict(nominationId=nomination_id, accept=accepted, reason=reason)
                    else:
                        require(nomination['status'] in ('pending', 'approved'), 'That nomination cannot be withdrawn.', 'conflict', 409)
                        reason = text(payload['reason'], 500, 'Reason')
                        nomination['status'] = 'withdrawn'
                        kind, details = 'arbiter_withdrawn', dict(nominationId=nomination_id, reason=reason)
                    nomination['respondedAt'] = now
    _event(state, role, kind, details, now)


def _replay(events, challenge_id):
    require(type(events) is list and 1 <= len(events) <= 256, 'Invalid stored event count.')
    first = fields(events[0], 'seq at actor kind details', 'Event')
    details = fields(first['details'], 'name terms termsVersion', 'Creation event')
    require(first['actor'] == 'proposer' and first['kind'] == 'created', 'Invalid creation event.')
    state = create_state(challenge_id, dict(name=details['name'], terms=details['terms']), integer(first['at'], 'Event time'))
    require(encode_json(state['events'][0]) == encode_json(first), 'Creation event does not match its recorded state.')
    mapping = {
        'terms_edited': ('terms', 'terms'), 'invite_issued': ('invite', 'seat'),
        'accepted': ('accept', 'termsVersion'), 'declined': ('decline', 'reason'),
        'withdrawn': ('withdraw', 'reason'), 'result_responded': ('result/respond', 'proposalId accept reason'),
        'void_confirmed': ('void/confirm', 'proposalId'), 'arbiter_responded': ('arbiter/respond', 'nominationId accept reason'),
        'arbiter_withdrawn': ('arbiter/withdraw', 'nominationId reason'), 'arbiter_decided': ('arbiter/decide', 'outcome reason'),
    }
    arbiter_invite_live = False
    for event in events[1:]:
        fields(event, 'seq at actor kind details', 'Event')
        now = integer(event['at'], 'Event time')
        role = choice(event['actor'], ROLES, 'Event role')
        kind, details = event['kind'], event['details']
        require(type(kind) is str and type(details) is dict, 'Invalid event fields.')
        if kind in ('opponent_joined', 'arbiter_joined'):
            seat = kind.split('_')[0]
            require(role == seat, 'Claim event actor does not match the seat.')
            fields(details, 'name' if seat == 'opponent' else 'nominationId name', 'Claim event')
            require(seat != 'arbiter' or arbiter_invite_live, 'Arbiter claim requires a live issued invitation.')
            apply_claim(state, seat, details['name'], now)
        else:
            require(state['profiles'][role] is not None, 'Event actor has not claimed a seat.')
            entity_id = None
            if kind in mapping:
                action, keys = mapping[kind]
                expected = keys + (' termsVersion' if kind == 'terms_edited' else '')
                fields(details, expected, 'Event details')
                payload = {key: details[key] for key in keys.split()}
            elif kind in ('evidence_added', 'result_proposed', 'void_offered', 'arbiter_nominated'):
                action, key, keys = {
                    'evidence_added': ('evidence', 'evidence', 'text url'),
                    'result_proposed': ('result', 'proposal', 'outcome reason'),
                    'void_offered': ('void', 'proposal', 'reason'),
                    'arbiter_nominated': ('arbiter/nominate', 'nomination', 'name reason'),
                }[kind]
                fields(details, key, 'Event details')
                entry = details[key]
                require(type(entry) is dict and all(field in entry for field in ('id', *keys.split())), 'Invalid event entry.')
                entity_id = entry['id']
                payload = {field: entry[field] for field in keys.split()}
            else:
                require(False, 'Unknown stored event kind.')
            apply_command(state, role, action, dict(revision=state['revision'], **payload), now, entity_id)
        require(encode_json(state['events'][-1]) == encode_json(event), 'Stored event disagrees with its transition.')
        if kind == 'invite_issued' and details['seat'] == 'arbiter':
            arbiter_invite_live = True
        elif kind in ('arbiter_nominated', 'arbiter_withdrawn', 'arbiter_joined') or state['status'] in TERMINAL:
            arbiter_invite_live = False
    return state


def validate_record(record):
    """Replay the bounded audit to detect incoherent persisted snapshots/counters."""
    try:
        fields(record, 'schemaVersion state hashes', 'Private record')
        require(type(record['schemaVersion']) is int and record['schemaVersion'] == 1, 'Unknown private record schema.')
        state = record['state']
        require(type(state) is dict and 'id' in state and 'events' in state, 'Invalid stored state.')
        replayed = _replay(state['events'], identifier(state['id']))
        require(encode_json(replayed) == encode_json(state), 'Stored snapshot disagrees with its audit.')
        hashes = fields(record['hashes'], 'proposer opponent arbiter opponentInvite arbiterInvite', 'Private capabilities')
        used = set()
        for key, digest in hashes.items():
            if digest is not None:
                require(type(digest) is str and TOKEN.fullmatch(digest) is not None and digest not in used, 'Invalid or duplicate capability digest.')
                used.add(digest)
            if key in ROLES:
                require((digest is not None) == (state['profiles'][key] is not None), 'Seat capability does not match claimed profile.')
        opponent_available = state['status'] == 'proposed' and state['profiles']['opponent'] is None
        require((hashes['opponentInvite'] is not None) == opponent_available, 'Opponent invitation state is inconsistent.')
        invite_live = False
        for event in state['events']:
            if event['kind'] == 'invite_issued' and event['details']['seat'] == 'arbiter':
                invite_live = True
            elif event['kind'] in ('arbiter_nominated', 'arbiter_withdrawn', 'arbiter_joined'):
                invite_live = False
        if state['status'] in TERMINAL:
            invite_live = False
        require((hashes['arbiterInvite'] is not None) == invite_live, 'Arbiter invitation state is inconsistent.')
        encode_json(record)
        return deepcopy(record)
    except (DomainError, KeyError, TypeError, ValueError, RecursionError):
        raise DomainError('internal_error', 'Stored challenge data is corrupt or unsupported. Preserve the data directory and restore a verified backup.', 500) from None


def snapshot(record, role, now):
    result = deepcopy(record['state'])
    result.update(serverTime=now, deadlinePassed=now >= result['terms']['deadline'], myRole=role)
    encode_json(result)
    return result
