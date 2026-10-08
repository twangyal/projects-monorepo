export type Id = string;
export type Role = 'proposer' | 'opponent' | 'arbiter';
export type Party = 'proposer' | 'opponent';
export type Seat = 'opponent' | 'arbiter';
export type Status = 'proposed' | 'active' | 'disputed' | 'resolved' | 'voided' | 'declined' | 'withdrawn';
export type Outcome = Party | 'void';
export type Stake = 'bragging-rights' | 'make-a-drink' | 'pick-a-movie' | 'do-the-dishes';
export interface Terms {
  title: string; description: string; successCriteria: string;
  evidenceRule: string; stake: Stake; deadline: number;
}
export interface Profile { name: string }
export interface ImageDescriptor {
  mime: 'image/jpeg'; bytes: number; width: number; height: number; sha256: string;
}
export interface TextEvidence {
  id: string; author: Party; text: string; url: string | null; createdAt: number; late: boolean;
}
export interface ImageEvidence extends TextEvidence { image: ImageDescriptor }
export type Evidence = TextEvidence | ImageEvidence;
export interface ResultProposal {
  id: string; proposedBy: Party; outcome: Party; reason: string;
  status: 'pending' | 'rejected'; createdAt: number; respondedAt: number | null;
}
export interface VoidProposal { id: string; proposedBy: Party; reason: string; createdAt: number }
export interface ArbiterNomination {
  id: string; name: string; proposedBy: Party; reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'; createdAt: number; respondedAt: number | null;
}
export interface Resolution {
  outcome: Outcome; method: 'mutual' | 'arbiter'; by: Role;
  reason: string; decidedAt: number; proposalId: string | null;
}
export interface LimitsUsed {
  termsEdits: number; resultProposals: number; arbiterNominations: number;
  opponentInvites: number; arbiterInvites: number;
}

type EventDetails = {
  created: { name: string; terms: Terms; termsVersion: number };
  terms_edited: { terms: Terms; termsVersion: number };
  invite_issued: { seat: Seat };
  opponent_joined: { name: string };
  accepted: { termsVersion: number };
  declined: { reason: string };
  withdrawn: { reason: string };
  evidence_added: { evidence: TextEvidence };
  evidence_image_added: { evidence: ImageEvidence };
  result_proposed: { proposal: ResultProposal };
  result_responded: { proposalId: string; accept: boolean; reason: string };
  void_offered: { proposal: VoidProposal };
  void_confirmed: { proposalId: string };
  arbiter_nominated: { nomination: ArbiterNomination };
  arbiter_responded: { nominationId: string; accept: boolean; reason: string };
  arbiter_withdrawn: { nominationId: string; reason: string };
  arbiter_joined: { nominationId: string; name: string };
  arbiter_decided: { outcome: Outcome; reason: string };
};
export type ChallengeEvent = {
  [Kind in keyof EventDetails]: { seq: number; at: number; actor: Role; kind: Kind; details: EventDetails[Kind] }
}[keyof EventDetails];

export interface Snapshot {
  id: string; revision: number; status: Status; termsVersion: number;
  terms: Terms; acceptedAt: number | null; createdAt: number; serverTime: number;
  deadlinePassed: boolean; myRole: Role;
  profiles: { proposer: Profile; opponent: Profile | null; arbiter: Profile | null };
  evidence: Evidence[]; events: ChallengeEvent[]; resultProposal: ResultProposal | null;
  voidProposal: VoidProposal | null; arbiterNomination: ArbiterNomination | null;
  resolution: Resolution | null; limitsUsed: LimitsUsed;
}
export interface Creation { challengeId: string; token: string; inviteToken: string; challenge: Snapshot }
export interface Claim { challengeId: string; token: string; challenge: Snapshot }
export interface Invitation { inviteToken: string; challenge: Snapshot }
export interface ChallengeExport {
  schemaVersion: 1 | 2; exportedAt: number; challenge: Omit<Snapshot, 'myRole' | 'serverTime'>;
}

export const STAKES = ['bragging-rights', 'make-a-drink', 'pick-a-movie', 'do-the-dishes'] as const;
export const ERROR_CODES = ['invalid_request', 'unauthorized', 'forbidden', 'not_found', 'conflict', 'limit', 'too_large', 'timeout', 'busy', 'internal_error'] as const;
export type ErrorCode = typeof ERROR_CODES[number];
// The final assertion requires the actual string end, including after newlines.
export const ID_PATTERN = /^[0-9a-f]{32}$(?![\s\S])/;
export const TOKEN_PATTERN = /^[0-9a-f]{64}$(?![\s\S])/;
