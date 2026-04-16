import type { OrchestratorContext } from './context.js';
import type { OrchestratorEvent } from './events.js';

type GuardArgs = { context: OrchestratorContext; event?: OrchestratorEvent };

// ---------------------------------------------------------------------------
// Path-based stage skipping
// Returns true when the stage should be SKIPPED (not present in path).
// ---------------------------------------------------------------------------

export const shouldSkipPrepare = ({ context }: GuardArgs): boolean =>
  !context.path.includes('prepare');

export const shouldSkipBrainstorm = ({ context }: GuardArgs): boolean =>
  !context.path.includes('brainstorm');

export const shouldSkipSpecReview = ({ context }: GuardArgs): boolean =>
  !context.path.includes('spec_review');

export const shouldSkipWritePlan = ({ context }: GuardArgs): boolean =>
  !context.path.includes('write_plan');

export const shouldSkipPlanReview = ({ context }: GuardArgs): boolean =>
  !context.path.includes('plan_review');

// ---------------------------------------------------------------------------
// Verdict routing
// Reads from context.last_review_verdict, set by storeReviewResult before
// guards evaluate.
// ---------------------------------------------------------------------------

export const isShip = ({ context }: GuardArgs): boolean =>
  context.last_review_verdict === 'SHIP';

export const isRevise = ({ context }: GuardArgs): boolean =>
  context.last_review_verdict === 'REVISE';

export const isRethink = ({ context }: GuardArgs): boolean =>
  context.last_review_verdict === 'RETHINK';

// ---------------------------------------------------------------------------
// Round limits
// ---------------------------------------------------------------------------

export const belowMaxRounds = ({ context }: GuardArgs): boolean =>
  context.review_round < context.max_review_rounds;

export const atMaxRounds = ({ context }: GuardArgs): boolean =>
  context.review_round >= context.max_review_rounds;

// ---------------------------------------------------------------------------
// Worker status routing
// Reads from event — only valid for WORKER_COMPLETE events.
// ---------------------------------------------------------------------------

export const workerSucceeded = ({ event }: GuardArgs): boolean =>
  event?.type === 'WORKER_COMPLETE' &&
  (event.status === 'DONE' || event.status === 'DONE_WITH_CONCERNS');

export const workerBlocked = ({ event }: GuardArgs): boolean =>
  event?.type === 'WORKER_COMPLETE' &&
  (event.status === 'NEEDS_CONTEXT' || event.status === 'BLOCKED');

// ---------------------------------------------------------------------------
// Decomposition
// ---------------------------------------------------------------------------

export const shouldDecompose = ({ context }: GuardArgs): boolean =>
  context.decompose === true;

// ---------------------------------------------------------------------------
// User decisions
// ---------------------------------------------------------------------------

export const isProceed = ({ event }: GuardArgs): boolean =>
  event?.type === 'USER_APPROVE' && event.decision === 'proceed';

export const isAbort = ({ event }: GuardArgs): boolean =>
  event?.type === 'USER_APPROVE' && event.decision === 'abort';

export const isRetry = ({ event }: GuardArgs): boolean =>
  event?.type === 'USER_ESCALATION_RESPONSE' && event.action === 'retry';

export const isSkip = ({ event }: GuardArgs): boolean =>
  event?.type === 'USER_ESCALATION_RESPONSE' && event.action === 'skip';

export const isAbortEscalation = ({ event }: GuardArgs): boolean =>
  event?.type === 'USER_ESCALATION_RESPONSE' && event.action === 'abort';

// ---------------------------------------------------------------------------
// Drift check
// ---------------------------------------------------------------------------

export const driftPass = ({ event }: GuardArgs): boolean =>
  event?.type === 'EXPERT_READY' && event.drift_check === 'pass';

export const driftFail = ({ event }: GuardArgs): boolean =>
  event?.type === 'EXPERT_READY' && event.drift_check === 'fail';

// ---------------------------------------------------------------------------
// Task completion
// guard is false when task_count === 0 to prevent premature "done" before
// decomposition registers tasks.
// ---------------------------------------------------------------------------

export const allTasksComplete = ({ context }: GuardArgs): boolean =>
  context.tasks_complete >= context.task_count && context.task_count > 0;

// ---------------------------------------------------------------------------
// User approval gate (risk-dependent)
// ---------------------------------------------------------------------------

export const requiresUserApproval = ({ context }: GuardArgs): boolean =>
  context.risk === 'critical';

// ---------------------------------------------------------------------------
// Sizing guards
// ---------------------------------------------------------------------------

export const sizingClearlyUnder = ({ context }: GuardArgs): boolean =>
  context.last_sizing_result?.verdict === 'under';

export const sizingClearlyOver = ({ context }: GuardArgs): boolean =>
  context.last_sizing_result?.verdict === 'over';

// ---------------------------------------------------------------------------
// Query result guards
// ---------------------------------------------------------------------------

export const isTaskReady = ({ event }: GuardArgs): boolean =>
  event?.type === 'QUERY_RESULT' && event.outcome === 'task_ready';

export const isAllComplete = ({ event }: GuardArgs): boolean =>
  event?.type === 'QUERY_RESULT' && event.outcome === 'all_complete';

export const isAllBlocked = ({ event }: GuardArgs): boolean =>
  event?.type === 'QUERY_RESULT' && event.outcome === 'all_blocked';

// ---------------------------------------------------------------------------
// Decomposition recommendation
// Checks the decomposition_recommended field on events that carry it
// (PrepareComplete, BrainstormComplete, PlanComplete).
// ---------------------------------------------------------------------------

export const decompositionRecommended = ({ event }: GuardArgs): boolean =>
  !!event &&
  'decomposition_recommended' in event &&
  (event as { decomposition_recommended: boolean }).decomposition_recommended === true;

// ---------------------------------------------------------------------------
// Haiku sizing result
// ---------------------------------------------------------------------------

export const isSingle = ({ event }: GuardArgs): boolean =>
  event?.type === 'HAIKU_SIZING_RESULT' && event.answer === 'single';

export const isMultiple = ({ event }: GuardArgs): boolean =>
  event?.type === 'HAIKU_SIZING_RESULT' && event.answer === 'multiple';
