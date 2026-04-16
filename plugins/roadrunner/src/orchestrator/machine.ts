import { setup, assign } from 'xstate';
import type { OrchestratorContext } from './context.js';
import type { OrchestratorEvent } from './events.js';
import { createDefaultContext } from './context.js';

// Guards
import {
  shouldSkipPrepare,
  shouldSkipBrainstorm,
  shouldSkipSpecReview,
  shouldSkipWritePlan,
  shouldSkipPlanReview,
  isShip,
  isRevise,
  belowMaxRounds,
  workerSucceeded,
  workerBlocked,
  shouldDecompose,
  isProceed,
  isAbort,
  isRetry,
  isSkip,
  isAbortEscalation,
  driftPass,
  driftFail,
  requiresUserApproval,
  sizingClearlyUnder,
  sizingClearlyOver,
  isTaskReady,
  isAllComplete,
  isAllBlocked,
  decompositionRecommended,
  isSingle,
  isMultiple,
} from './guards.js';

// Actions — assign actions
import {
  storeTriageResult,
  configureFromRisk,
  storeCurrentTask,
  storeExpertResult,
  storeWorkerResult,
  storeReviewResult,
  storeDecomposition,
  storePrepareResult,
  storeBrainstormResult,
  storePlanResult,
  resetReviewRound,
  markTaskDone,
  markTaskSkipped,
  markBlockedTasksSkipped,
  recordAbort,
  handleCompactionDetected,
  recordDispatchError,
  runMechanicalSizing,
} from './actions.js';

// Actions — dispatcher actions (side effects)
import {
  dispatchTriage,
  dispatchPrepare,
  dispatchBrainstorm,
  dispatchSpecReview,
  dispatchWritePlan,
  dispatchPlanReview,
  dispatchDecompose,
  dispatchQueryNextTask,
  dispatchGenerateExpert,
  dispatchWorker,
  dispatchReview,
  dispatchHaikuSizing,
  dispatchDecomposeArtifact,
  dispatchRedecompose,
  dispatchFinish,
  emitPipelineSummary,
  escalateDrift,
  escalateWorker,
  escalateReview,
  escalateTimeout,
  escalateBlocked,
  escalateDispatchError,
  requestApproval,
} from './actions.js';

// ---------------------------------------------------------------------------
// Inline assign action for STATUS_ROLLUP (not in actions.ts)
// ---------------------------------------------------------------------------
const updateTaskCounters = assign(
  ({ context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
    if (event.type !== 'STATUS_ROLLUP') return {};
    return {
      tasks_complete: event.children_complete,
    };
  },
);

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

export const orchestratorMachine = setup({
  types: {} as {
    context: OrchestratorContext;
    events: OrchestratorEvent;
  },

  guards: {
    // Stage skipping
    shouldSkipPrepare,
    shouldSkipBrainstorm,
    shouldSkipSpecReview,
    shouldSkipWritePlan,
    shouldSkipPlanReview,

    // Verdict routing
    isShip,
    isRevise,

    // Round limits
    belowMaxRounds,

    // Worker status
    workerSucceeded,
    workerBlocked,

    // Decomposition
    shouldDecompose,
    shouldNotDecompose: ({ context }) => !context.decompose,

    // User decisions
    isProceed,
    isAbort,
    isRetry,
    isSkip,
    isAbortEscalation,

    // Drift check
    driftPass,
    driftFail,

    // User approval gate
    requiresUserApproval,

    // Sizing
    sizingClearlyUnder,
    sizingClearlyOver,

    // Query results
    isTaskReady,
    isAllComplete,
    isAllBlocked,

    // Decomposition recommendation
    decompositionRecommended,

    // Haiku sizing
    isSingle,
    isMultiple,

    // Compound guards
    isShipAndRequiresApproval: ({ context }) =>
      context.last_review_verdict === 'SHIP' && context.risk === 'critical',
    isShipNoApproval: ({ context }) =>
      context.last_review_verdict === 'SHIP' && context.risk !== 'critical',
    isReviseAndBelowMax: ({ context }) =>
      context.last_review_verdict === 'REVISE' && context.review_round < context.max_review_rounds,

    // onDone routing guards (read context after child final state)
    hasAbortReason: ({ context }) => context.abort_reason !== null,
    lastVerdictIsRevise: ({ context }) => context.last_review_verdict === 'REVISE',
    sizingIsOver: ({ context }) => context.last_sizing_result?.verdict === 'over',
  },

  // The assign actions from actions.ts are typed with explicit
  // { context: OrchestratorContext; event: OrchestratorEvent } signatures.
  // XState v5's setup() infers a slightly different internal event wrapper,
  // causing a variance mismatch on _out_TEvent. The runtime behavior is
  // identical — every assign function checks event.type before reading fields.
  // We cast to any at the registration boundary to satisfy the type checker.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions: {
    // Assign actions (cast to satisfy XState internal event variance)
    storeTriageResult: storeTriageResult as any,
    configureFromRisk: configureFromRisk as any,
    storeCurrentTask: storeCurrentTask as any,
    storeExpertResult: storeExpertResult as any,
    storeWorkerResult: storeWorkerResult as any,
    storeReviewResult: storeReviewResult as any,
    storeDecomposition: storeDecomposition as any,
    storePrepareResult: storePrepareResult as any,
    storeBrainstormResult: storeBrainstormResult as any,
    storePlanResult: storePlanResult as any,
    resetReviewRound: resetReviewRound as any,
    markTaskDone: markTaskDone as any,
    markTaskSkipped: markTaskSkipped as any,
    markBlockedTasksSkipped: markBlockedTasksSkipped as any,
    recordAbort: recordAbort as any,
    handleCompactionDetected: handleCompactionDetected as any,
    recordDispatchError: recordDispatchError as any,
    runMechanicalSizing: runMechanicalSizing as any,
    updateTaskCounters: updateTaskCounters as any,

    // Dispatcher actions (side effects — cast for same reason)
    dispatchTriage: dispatchTriage as any,
    dispatchPrepare: dispatchPrepare as any,
    dispatchBrainstorm: dispatchBrainstorm as any,
    dispatchSpecReview: dispatchSpecReview as any,
    dispatchWritePlan: dispatchWritePlan as any,
    dispatchPlanReview: dispatchPlanReview as any,
    dispatchDecompose: dispatchDecompose as any,
    dispatchQueryNextTask: dispatchQueryNextTask as any,
    dispatchGenerateExpert: dispatchGenerateExpert as any,
    dispatchWorker: dispatchWorker as any,
    dispatchReview: dispatchReview as any,
    dispatchHaikuSizing: dispatchHaikuSizing as any,
    dispatchDecomposeArtifact: dispatchDecomposeArtifact as any,
    dispatchRedecompose: dispatchRedecompose as any,
    dispatchFinish: dispatchFinish as any,
    emitPipelineSummary: emitPipelineSummary as any,
    escalateDrift: escalateDrift as any,
    escalateWorker: escalateWorker as any,
    escalateReview: escalateReview as any,
    escalateTimeout: escalateTimeout as any,
    escalateBlocked: escalateBlocked as any,
    escalateDispatchError: escalateDispatchError as any,
    requestApproval: requestApproval as any,
  },

  delays: {
    WORKER_TIMEOUT: ({ context }) => context.worker_timeout_ms,
    REVIEW_TIMEOUT: ({ context }) => context.review_timeout_ms,
    SIZING_TIMEOUT: () => 60_000,
    QUERY_TIMEOUT: () => 60_000,
  },
}).createMachine({
  id: 'roadrunner-orchestrator',
  context: createDefaultContext(),
  initial: 'idle',

  // Global handlers — events handled in any state
  on: {
    DISPATCH_ERROR: {
      actions: ['recordDispatchError', 'escalateDispatchError'],
    },
    STATUS_ROLLUP: {
      actions: ['updateTaskCounters'],
    },
  },

  states: {
    // =========================================================================
    // IDLE — waiting for START event
    // =========================================================================
    idle: {
      on: {
        START: { target: 'triage' },
      },
    },

    // =========================================================================
    // TRIAGE — classify input and determine pipeline path
    // =========================================================================
    triage: {
      entry: ['dispatchTriage'],
      on: {
        TRIAGE_COMPLETE: {
          target: 'prepare',
          actions: ['storeTriageResult', 'configureFromRisk'],
        },
      },
    },

    // =========================================================================
    // PREPARE — enrich/validate the spec
    // =========================================================================
    prepare: {
      always: [
        { guard: 'shouldSkipPrepare', target: 'brainstorm' },
      ],
      entry: ['dispatchPrepare'],
      on: {
        PREPARE_COMPLETE: [
          {
            guard: 'decompositionRecommended',
            target: 'develop',
            actions: ['storePrepareResult', 'dispatchDecomposeArtifact'],
          },
          {
            target: 'brainstorm',
            actions: ['storePrepareResult'],
          },
        ],
      },
    },

    // =========================================================================
    // BRAINSTORM — expand ideas, alternatives
    // =========================================================================
    brainstorm: {
      always: [
        { guard: 'shouldSkipBrainstorm', target: 'size_check_pre_spec' },
      ],
      entry: ['dispatchBrainstorm'],
      on: {
        BRAINSTORM_COMPLETE: [
          {
            guard: 'decompositionRecommended',
            target: 'develop',
            actions: ['storeBrainstormResult', 'dispatchDecomposeArtifact'],
          },
          {
            target: 'size_check_pre_spec',
            actions: ['storeBrainstormResult'],
          },
        ],
      },
    },

    // =========================================================================
    // SIZE CHECK PRE-SPEC — mechanical + optional Haiku sizing gate
    // =========================================================================
    size_check_pre_spec: {
      always: [
        { guard: 'shouldSkipSpecReview', target: 'write_plan' },
      ],
      entry: ['runMechanicalSizing'],
      initial: 'evaluating',
      states: {
        evaluating: {
          always: [
            { guard: 'sizingClearlyUnder', target: 'proceed' },
            { guard: 'sizingClearlyOver', target: 'decompose' },
          ],
          // If neither guard fires (ambiguous), we stay and dispatch Haiku
          entry: ['dispatchHaikuSizing'],
          on: {
            HAIKU_SIZING_RESULT: [
              { guard: 'isSingle', target: 'proceed' },
              { guard: 'isMultiple', target: 'decompose' },
            ],
          },
          after: {
            SIZING_TIMEOUT: { target: 'proceed' },
          },
        },
        proceed: { type: 'final' as const },
        decompose: { type: 'final' as const },
      },
      onDone: [
        {
          guard: 'sizingIsOver',
          target: 'develop',
          actions: ['dispatchDecomposeArtifact'],
        },
        {
          target: 'spec_review',
        },
      ],
    },

    // =========================================================================
    // SPEC REVIEW — compound review state
    // =========================================================================
    spec_review: {
      always: [
        { guard: 'shouldSkipSpecReview', target: 'write_plan' },
      ],
      initial: 'dispatching_review',
      states: {
        dispatching_review: {
          entry: ['dispatchSpecReview'],
          always: [{ target: 'awaiting_review' }],
        },
        awaiting_review: {
          after: {
            REVIEW_TIMEOUT: {
              target: 'escalate',
              actions: ['escalateTimeout'],
            },
          },
          on: {
            REVIEW_COMPLETE: {
              target: 'route_verdict',
              actions: ['storeReviewResult'],
            },
          },
        },
        route_verdict: {
          always: [
            {
              guard: 'isShipAndRequiresApproval',
              target: 'awaiting_approval',
            },
            {
              guard: 'isShipNoApproval',
              target: 'exit',
            },
            {
              guard: 'isReviseAndBelowMax',
              target: 'dispatching_review',
            },
            {
              // fallthrough: escalate
              target: 'escalate',
              actions: ['escalateReview'],
            },
          ],
        },
        awaiting_approval: {
          entry: ['requestApproval'],
          on: {
            USER_APPROVE: [
              {
                guard: 'isProceed',
                target: 'exit',
              },
              {
                guard: 'isAbort',
                target: '#roadrunner-orchestrator.done',
                actions: ['recordAbort'],
              },
            ],
          },
        },
        escalate: {
          on: {
            USER_ESCALATION_RESPONSE: [
              {
                guard: 'isRetry',
                target: 'dispatching_review',
                actions: ['resetReviewRound'],
              },
              {
                guard: 'isSkip',
                target: 'exit',
              },
              {
                guard: 'isAbortEscalation',
                target: '#roadrunner-orchestrator.done',
                actions: ['recordAbort'],
              },
            ],
          },
        },
        exit: { type: 'final' as const },
      },
      onDone: { target: 'write_plan' },
    },

    // =========================================================================
    // WRITE PLAN — generate implementation plan from spec
    // =========================================================================
    write_plan: {
      always: [
        { guard: 'shouldSkipWritePlan', target: 'size_check_pre_plan' },
      ],
      entry: ['dispatchWritePlan'],
      on: {
        PLAN_COMPLETE: [
          {
            guard: 'decompositionRecommended',
            target: 'develop',
            actions: ['storePlanResult', 'dispatchDecomposeArtifact'],
          },
          {
            target: 'size_check_pre_plan',
            actions: ['storePlanResult'],
          },
        ],
      },
    },

    // =========================================================================
    // SIZE CHECK PRE-PLAN — mechanical + optional Haiku sizing gate
    // =========================================================================
    size_check_pre_plan: {
      always: [
        { guard: 'shouldSkipPlanReview', target: 'develop' },
      ],
      entry: ['runMechanicalSizing'],
      initial: 'evaluating',
      states: {
        evaluating: {
          always: [
            { guard: 'sizingClearlyUnder', target: 'proceed' },
            { guard: 'sizingClearlyOver', target: 'decompose' },
          ],
          entry: ['dispatchHaikuSizing'],
          on: {
            HAIKU_SIZING_RESULT: [
              { guard: 'isSingle', target: 'proceed' },
              { guard: 'isMultiple', target: 'decompose' },
            ],
          },
          after: {
            SIZING_TIMEOUT: { target: 'proceed' },
          },
        },
        proceed: { type: 'final' as const },
        decompose: { type: 'final' as const },
      },
      onDone: [
        {
          guard: 'sizingIsOver',
          target: 'develop',
          actions: ['dispatchDecomposeArtifact'],
        },
        {
          target: 'plan_review',
        },
      ],
    },

    // =========================================================================
    // PLAN REVIEW — compound review state (same structure as spec_review)
    // =========================================================================
    plan_review: {
      always: [
        { guard: 'shouldSkipPlanReview', target: 'develop' },
      ],
      initial: 'dispatching_review',
      states: {
        dispatching_review: {
          entry: ['dispatchPlanReview'],
          always: [{ target: 'awaiting_review' }],
        },
        awaiting_review: {
          after: {
            REVIEW_TIMEOUT: {
              target: 'escalate',
              actions: ['escalateTimeout'],
            },
          },
          on: {
            REVIEW_COMPLETE: {
              target: 'route_verdict',
              actions: ['storeReviewResult'],
            },
          },
        },
        route_verdict: {
          always: [
            {
              guard: 'isShipAndRequiresApproval',
              target: 'awaiting_approval',
            },
            {
              guard: 'isShipNoApproval',
              target: 'exit',
            },
            {
              guard: 'isReviseAndBelowMax',
              target: 'dispatching_review',
            },
            {
              target: 'escalate',
              actions: ['escalateReview'],
            },
          ],
        },
        awaiting_approval: {
          entry: ['requestApproval'],
          on: {
            USER_APPROVE: [
              {
                guard: 'isProceed',
                target: 'exit',
              },
              {
                guard: 'isAbort',
                target: '#roadrunner-orchestrator.done',
                actions: ['recordAbort'],
              },
            ],
          },
        },
        escalate: {
          on: {
            USER_ESCALATION_RESPONSE: [
              {
                guard: 'isRetry',
                target: 'dispatching_review',
                actions: ['resetReviewRound'],
              },
              {
                guard: 'isSkip',
                target: 'exit',
              },
              {
                guard: 'isAbortEscalation',
                target: '#roadrunner-orchestrator.done',
                actions: ['recordAbort'],
              },
            ],
          },
        },
        exit: { type: 'final' as const },
      },
      onDone: { target: 'develop' },
    },

    // =========================================================================
    // DEVELOP — compound state: decompose, execute tasks, review each
    // =========================================================================
    develop: {
      initial: 'decompose',
      states: {
        // --- Decompose ---
        decompose: {
          always: [
            {
              guard: 'shouldNotDecompose',
              target: 'next_task',
              actions: ['dispatchQueryNextTask'],
            },
          ],
          entry: ['dispatchDecompose'],
          on: {
            DECOMPOSITION_COMPLETE: {
              target: 'next_task',
              actions: ['storeDecomposition', 'dispatchQueryNextTask'],
            },
          },
        },

        // --- Next Task ---
        next_task: {
          after: {
            QUERY_TIMEOUT: {
              target: 'escalate_blocked',
              actions: ['escalateTimeout'],
            },
          },
          on: {
            QUERY_RESULT: [
              {
                guard: 'isTaskReady',
                target: 'generate_expert',
                actions: ['storeCurrentTask', 'dispatchGenerateExpert'],
              },
              {
                guard: 'isAllComplete',
                target: 'finish_develop',
              },
              {
                guard: 'isAllBlocked',
                target: 'escalate_blocked',
              },
            ],
          },
        },

        // --- Generate Expert ---
        generate_expert: {
          after: {
            REVIEW_TIMEOUT: {
              target: 'escalate_drift',
              actions: ['escalateTimeout'],
            },
          },
          on: {
            EXPERT_READY: [
              {
                guard: 'driftPass',
                target: 'dispatch_worker',
                actions: ['storeExpertResult', 'dispatchWorker'],
              },
              {
                guard: 'driftFail',
                target: 'escalate_drift',
                actions: ['escalateDrift'],
              },
            ],
          },
        },

        // --- Dispatch Worker ---
        dispatch_worker: {
          entry: ['resetReviewRound'],
          always: [{ target: 'await_worker' }],
        },

        // --- Await Worker ---
        await_worker: {
          after: {
            WORKER_TIMEOUT: {
              target: 'escalate_worker',
              actions: ['escalateTimeout'],
            },
          },
          on: {
            WORKER_COMPLETE: [
              {
                guard: 'workerSucceeded',
                target: 'review_task',
                actions: ['storeWorkerResult', 'dispatchReview'],
              },
              {
                guard: 'workerBlocked',
                target: 'escalate_worker',
                actions: ['storeWorkerResult', 'escalateWorker'],
              },
            ],
            COMPACTION_DETECTED: {
              target: 'escalate_worker',
              actions: ['handleCompactionDetected', 'dispatchRedecompose'],
            },
          },
        },

        // --- Review Task (COMPOUND) ---
        review_task: {
          initial: 'dispatching_review',
          states: {
            dispatching_review: {
              entry: ['dispatchReview'],
              always: [{ target: 'awaiting_review' }],
            },
            awaiting_review: {
              after: {
                REVIEW_TIMEOUT: {
                  target: 'escalate',
                  actions: ['escalateTimeout'],
                },
              },
              on: {
                REVIEW_COMPLETE: {
                  target: 'route_verdict',
                  actions: ['storeReviewResult'],
                },
              },
            },
            route_verdict: {
              always: [
                {
                  guard: 'isShip',
                  target: 'exit_ship',
                  actions: ['markTaskDone', 'dispatchQueryNextTask'],
                },
                {
                  guard: 'isReviseAndBelowMax',
                  target: 'exit_revise',
                },
                {
                  // fallthrough: escalate
                  target: 'escalate',
                  actions: ['escalateReview'],
                },
              ],
            },
            escalate: {
              on: {
                USER_ESCALATION_RESPONSE: [
                  {
                    guard: 'isRetry',
                    target: 'dispatching_review',
                    actions: ['resetReviewRound'],
                  },
                  {
                    guard: 'isSkip',
                    target: 'exit_skip',
                    actions: ['markTaskSkipped', 'dispatchQueryNextTask'],
                  },
                  {
                    guard: 'isAbortEscalation',
                    target: 'exit_abort',
                    actions: ['recordAbort'],
                  },
                ],
              },
            },
            exit_ship: { type: 'final' as const },
            exit_revise: { type: 'final' as const },
            exit_skip: { type: 'final' as const },
            exit_abort: { type: 'final' as const },
          },
          onDone: [
            {
              guard: 'hasAbortReason',
              target: 'abort',
            },
            {
              guard: 'lastVerdictIsRevise',
              target: 'dispatch_worker',
              actions: ['dispatchWorker'],
            },
            {
              // default: task done or skipped, go to next_task
              target: 'next_task',
            },
          ],
        },

        // --- Escalate: Blocked ---
        escalate_blocked: {
          entry: ['escalateBlocked'],
          on: {
            USER_ESCALATION_RESPONSE: [
              {
                guard: 'isRetry',
                target: 'next_task',
                actions: ['dispatchQueryNextTask'],
              },
              {
                guard: 'isSkip',
                target: 'finish_develop',
                actions: ['markBlockedTasksSkipped'],
              },
              {
                guard: 'isAbortEscalation',
                target: 'abort',
                actions: ['recordAbort'],
              },
            ],
          },
        },

        // --- Escalate: Drift ---
        escalate_drift: {
          on: {
            USER_ESCALATION_RESPONSE: [
              {
                guard: 'isRetry',
                target: 'generate_expert',
                actions: ['dispatchGenerateExpert'],
              },
              {
                guard: 'isSkip',
                target: 'next_task',
                actions: ['markTaskSkipped', 'dispatchQueryNextTask'],
              },
              {
                guard: 'isAbortEscalation',
                target: 'abort',
                actions: ['recordAbort'],
              },
            ],
          },
        },

        // --- Escalate: Worker ---
        escalate_worker: {
          on: {
            USER_ESCALATION_RESPONSE: [
              {
                guard: 'isRetry',
                target: 'dispatch_worker',
                actions: ['dispatchWorker'],
              },
              {
                guard: 'isSkip',
                target: 'next_task',
                actions: ['markTaskSkipped', 'dispatchQueryNextTask'],
              },
              {
                guard: 'isAbortEscalation',
                target: 'abort',
                actions: ['recordAbort'],
              },
            ],
          },
        },

        // --- Terminal sub-states ---
        finish_develop: { type: 'final' as const },
        abort: { type: 'final' as const },
      },

      // When develop compound state completes (a child reaches final)
      onDone: [
        {
          guard: 'hasAbortReason',
          target: 'done',
        },
        {
          target: 'finish',
        },
      ],
    },

    // =========================================================================
    // FINISH — wrap up pipeline
    // =========================================================================
    finish: {
      entry: ['dispatchFinish'],
      on: {
        FINISH_COMPLETE: {
          target: 'done',
          actions: ['emitPipelineSummary'],
        },
      },
    },

    // =========================================================================
    // DONE — terminal state
    // =========================================================================
    done: {
      type: 'final' as const,
    },

    // =========================================================================
    // FAILED — terminal error state
    // =========================================================================
    failed: {
      type: 'final' as const,
    },
  },
});
