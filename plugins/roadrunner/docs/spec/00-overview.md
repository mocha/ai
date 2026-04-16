# Composed Pipeline — Architecture Overview

An AI-assisted development pipeline assembled from small, independently
replaceable tools with file-based contracts between each layer. No
monolithic framework dependency. Every layer can be swapped without
rebuilding the rest.

## Layers

| # | Layer | Primary tool(s) | Responsibility |
|---|---|---|---|
| 1 | Triage & routing | Skylark skills | Classify input, assess risk, determine pipeline path |
| 2 | Orchestrator | XState v5 | Deterministic state machine driving stage transitions |
| 3 | Task substrate | Taskmaster AI (MCP) | Task decomposition, DAG tracking, status management |
| 4 | Expert generation & review | Skylark skills + `_shared/` | Vocabulary-routed prompts, panel review, typed verdicts |
| 5 | Worker execution | Claude Code CLI + git worktrees | Isolated per-task implementation sessions |
| 6 | Monitoring & observability | OpenLLMetry + Langfuse | Telemetry capture, cost tracking, dashboards |
| 7 | Context engineering | context-mode + budget hooks | Context conservation, predecessor query, budget enforcement |

Layers 1-5 form the sequential pipeline. Layers 6-7 are cross-cutting
concerns that attach to every worker session.

## End-to-end flow

```mermaid
flowchart TD
    subgraph Entry["Entry"]
        INPUT["User input<br/><i>file, description, idea,<br/>issue ref, bug report</i>"]
    end

    subgraph L1["LAYER 1 — Triage & Routing<br/><b>Skylark skills</b>"]
        T1["Classify input type"]
        T2["Detect existing artifacts"]
        T3["Assess risk level"]
        T4["Determine pipeline path"]
        T1 --> T2 --> T3 --> T4
    end

    subgraph L2["LAYER 2 — Orchestrator<br/><b>XState v5</b>"]
        O_INIT["Load or restore<br/>.skylark/state.json"]
        O_RECV["Receive event"]
        O_TRANS["Evaluate guards,<br/>fire transition"]
        O_PERSIST["Persist snapshot<br/>to .skylark/state.json"]
        O_DISPATCH["Dispatch to<br/>target layer"]
        O_INIT --> O_RECV --> O_TRANS --> O_PERSIST --> O_DISPATCH
    end

    subgraph L3["LAYER 3 — Task Substrate<br/><b>Taskmaster AI (MCP)</b>"]
        TS_DECOMP["Decompose spec<br/>into task DAG"]
        TS_QUERY["Query: next ready<br/>task (deps met)"]
        TS_UPDATE["Update task status<br/>on completion"]
        TS_ROLLUP["Roll up status<br/>to parent"]
        TS_DECOMP --> TS_QUERY
        TS_UPDATE --> TS_ROLLUP
    end

    subgraph L4["LAYER 4 — Expert Generation & Review<br/><b>Skylark skills + _shared/</b>"]
        direction TB
        subgraph PRE["Pre-dispatch"]
            EG_VOCAB["Extract vocabulary<br/>(15-30 domain terms)"]
            EG_PROMPT["Generate expert<br/>prompt (identity +<br/>vocab + anti-patterns)"]
            EG_DRIFT["Pre-dispatch drift<br/>validation (grep)"]
        end

        subgraph POST["Post-implementation"]
            RV_SPEC["Spec compliance<br/>solo review"]
            RV_PANEL["Code quality<br/>panel review"]
            RV_VERDICT["Emit typed verdict:<br/>SHIP / REVISE / RETHINK"]
        end

        EG_VOCAB --> EG_PROMPT --> EG_DRIFT
        RV_SPEC --> RV_PANEL --> RV_VERDICT
    end

    subgraph L5["LAYER 5 — Worker Execution<br/><b>Claude Code CLI + worktree</b>"]
        W_WT["Create git worktree"]
        W_CLAUDE["Write expert prompt<br/>as .claude/CLAUDE.md"]
        W_EXEC["claude --bare -p<br/>--output-format json<br/>--max-turns N"]
        W_RESULT["Parse structured<br/>result JSON"]
        W_WT --> W_CLAUDE --> W_EXEC --> W_RESULT
    end

    subgraph L6["LAYER 6 — Monitoring<br/><b>OpenLLMetry + Langfuse</b>"]
        M_INSTR["Instrument API calls<br/>(gen_ai.* spans)"]
        M_BRIDGE["Worker telemetry<br/>bridge (CLI → REST)"]
        M_STORE["Langfuse: store,<br/>cost, dashboard"]
    end

    subgraph L7["LAYER 7 — Context Engineering<br/><b>context-mode + budget hooks</b>"]
        C_SESSION["SessionStart:<br/>load predecessor state"]
        C_SANDBOX["PostToolUse:<br/>sandbox tool output"]
        C_COMPACT["PreCompact:<br/>persist + signal"]
        C_BUDGET["Budget hooks:<br/>40% / 60% / 70% alerts"]
    end

    %% Main pipeline flow
    INPUT --> T1
    T4 -->|"triage_result"| O_RECV
    O_DISPATCH -->|"DECOMPOSE cmd"| TS_DECOMP
    O_DISPATCH -->|"DISPATCH_TASK cmd"| EG_VOCAB
    TS_QUERY -->|"task spec"| O_RECV
    EG_DRIFT -->|"expert prompt<br/>+ task spec"| W_WT
    W_RESULT -->|"worker result"| RV_SPEC
    RV_VERDICT -->|"verdict event"| O_RECV
    TS_ROLLUP -->|"status event"| O_RECV

    %% Worker → Task status
    W_RESULT -->|"update status"| TS_UPDATE

    %% Review loop
    O_DISPATCH -->|"RE-DISPATCH<br/>(on REVISE)"| W_WT

    %% Cross-cutting: monitoring attaches to workers
    W_EXEC -.->|"per-call spans"| M_INSTR
    W_RESULT -.->|"cost + duration"| M_BRIDGE
    M_INSTR -.-> M_STORE
    M_BRIDGE -.-> M_STORE

    %% Cross-cutting: context engineering attaches to worker sessions
    W_EXEC -.-> C_SESSION
    W_EXEC -.-> C_SANDBOX
    W_EXEC -.-> C_COMPACT
    W_EXEC -.-> C_BUDGET

    %% Styling
    classDef layer1 fill:#e8f4f8,stroke:#2196F3,color:#000
    classDef layer2 fill:#fff3e0,stroke:#FF9800,color:#000
    classDef layer3 fill:#e8f5e9,stroke:#4CAF50,color:#000
    classDef layer4 fill:#fce4ec,stroke:#E91E63,color:#000
    classDef layer5 fill:#f3e5f5,stroke:#9C27B0,color:#000
    classDef layer6 fill:#e0f2f1,stroke:#009688,color:#000
    classDef layer7 fill:#fff8e1,stroke:#FFC107,color:#000

    class T1,T2,T3,T4 layer1
    class O_INIT,O_RECV,O_TRANS,O_PERSIST,O_DISPATCH layer2
    class TS_DECOMP,TS_QUERY,TS_UPDATE,TS_ROLLUP layer3
    class EG_VOCAB,EG_PROMPT,EG_DRIFT,RV_SPEC,RV_PANEL,RV_VERDICT layer4
    class W_WT,W_CLAUDE,W_EXEC,W_RESULT layer5
    class M_INSTR,M_BRIDGE,M_STORE layer6
    class C_SESSION,C_SANDBOX,C_COMPACT,C_BUDGET layer7
```

## Risk-based pipeline activation

Not every layer runs for every task. The triage layer determines risk,
and the orchestrator activates stages accordingly.

| Stage | Trivial | Standard | Elevated | Critical |
|---|:---:|:---:|:---:|:---:|
| L1 Triage | yes | yes | yes | yes |
| L3 Decomposition | skip | skip | yes | yes |
| L4 Expert generation | skip | yes | yes | yes |
| L4 Spec review | skip | skip | Opus 3-4 | Opus 5→3 |
| L4 Plan review | skip | skip | Opus 3-4 | Opus 5→3 |
| L5 Worktree isolation | no | yes | yes | yes |
| L4 Code quality panel | skip | Sonnet 2-3 | Sonnet 3-4 | Opus 3-4 |
| L6 Telemetry | yes | yes | yes | yes |
| L7 Context engineering | yes | yes | yes | yes |

## File layout

```
.skylark/
├── state.json                  # XState persisted snapshot (L2)
├── experts/
│   └── TASK-NNN.md             # Generated expert prompts (L4)
├── verdicts/
│   └── TASK-NNN.json           # Review verdicts (L4)
├── results/
│   └── TASK-NNN.json           # Worker results (L5)
└── telemetry/
    └── TASK-NNN.json           # Per-task cost/duration (L6)

.taskmaster/
├── tasks.json                  # Canonical task DAG (L3)
└── config.json                 # Taskmaster configuration (L3)

docs/
├── specs/
│   └── SPEC-NNN-<slug>.md      # Spec artifacts (L1/L4)
├── plans/
│   └── PLAN-NNN-<slug>.md      # Plan artifacts (L4)
├── reports/
│   └── R-<timestamp>-*.md      # Review reports (L4)
└── notes/
    └── NOTE-NNN-<slug>.md      # Session notes (L5)
```

## Contract summary

Each layer's input and output contracts are defined in the layer's
spec document. The overview here shows the flow:

```
L1 produces → triage_result (risk, type, path, artifact refs)
     ↓
L2 consumes triage_result → dispatches DECOMPOSE or DISPATCH_TASK
     ↓                ↑
L3 produces → task specs   │  L3 produces → status events
     ↓                     │       ↑
L4 produces → expert prompt + drift check   │
     ↓                     │       │
L5 produces → worker result (status, cost, files changed)
     ↓                     │       │
L4 produces → typed verdict (SHIP/REVISE/RETHINK)
                           │       │
     └─────────────────────┘       │
     verdict event → L2 routes:    │
       SHIP → L3 update complete ──┘
       REVISE → L5 re-dispatch (round < 2)
       RETHINK → escalate to user
```

## Spec documents

- [01 — Triage & routing](01-triage-and-routing.md)
- [02 — Orchestrator](02-orchestrator.md)
- [03 — Task substrate](03-task-substrate.md)
- [04 — Expert generation & review](04-expert-generation-and-review.md)
- [05 — Worker execution](05-worker-execution.md)
- [06 — Monitoring & observability](06-monitoring.md)
- [07 — Context engineering](07-context-engineering.md)
