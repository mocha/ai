# triad

**Status:** Retired experiment, preserved for posterity and analysis.

A three-agent autonomous development framework — **Product Manager**,
**Program Manager**, **Engineering Manager** — coordinating through file-based
inbox messages with tmux notifications.

The execution half worked well. The coordination half is why this is retired:
inter-agent communication via filesystem messages turned out to be brittle,
noisy, and hard to debug once more than a handful of messages were in flight.
Later work (see `skylark`) replaced the persistent-agent-with-inbox model with
vocabulary-routed expert invocations inside a single pipeline.

## The pipeline it ran

```
Human (strategy) → PM (proposals) → PgM (projects) → EM (tasks) → Dev (code)
```

| Role | Produces | Primary Concern |
|---|---|---|
| Product Manager | Proposals (PMD-NNN) | Customer value, outcomes |
| Program Manager | Projects (PRJ-NNN) | Sequencing, feasibility |
| Engineering Manager | Tasks (T-NNN) | Execution, worker dispatch |

Each agent ran as its own Claude Code session in a tmux pane. Messages were
written as markdown files to `docs/inbox/<agent>/`, and an `fswatch`-based
watcher sent tmux notifications on new files. Negotiation was bounded to two
revision cycles per boundary before human escalation.

## What's preserved

```
plugins/triad/
├── .claude-plugin/plugin.json
├── skills/                         # Orchestration skills (for the supervisor session)
│   ├── start/                      # /triad:start  — create session, launch agents
│   ├── kick/                       # /triad:kick   — restart crashed agents
│   ├── status/                     # /triad:status — capture state of all panes
│   └── resume/                     # /triad:resume — reconnect + verify
├── agents/
│   ├── product-manager/            # Identity, philosophy, skills, rules
│   ├── program-manager/            # Identity, philosophy, skills, rules
│   └── engineering-manager/        # Identity, worker-dispatch template, rules
├── scripts/
│   ├── init-project.sh             # Set up protocol dirs in a target project
│   ├── inbox-watcher.service       # systemd unit template (Linux)
│   └── com.deuleyville.inbox-watcher.plist  # launchd plist (macOS)
├── templates/                      # Document formats: proposal, project, task, message
│   └── workspace-layout/           # Directory skeleton that init-project.sh lays down
└── docs/
    ├── specs/                      # Protocol + three-agent design specs
    ├── plans/                      # Implementation plan
    ├── operations/                 # session-startup, onboarding guides
    └── ORIGINAL_{README,CLAUDE,CONTEXT}.md  # Source-repo framing docs
```

## What went wrong (short version)

- **Inbox watchers were noisy.** Debouncing helped but never felt solid.
  Message flurries during handoffs could overwhelm a pane.
- **State drift between agents.** Each agent kept its own read cursor, so
  recovery after a crash (`/triad:kick`) required careful state reconstruction
  that the skill tried to automate but never fully nailed.
- **Conversation context wasn't shared.** An agent couldn't cheaply ask
  "what did you already tell PM?" without re-reading the inbox log.
- **Human-in-the-loop was awkward.** Escalation worked, but routing a human
  reply back into the pipeline was manual.
- **Session access tempts humans to fiddle.** Access to the visible tmux panes was too tempting for me and I kept poking at things mid-stream, causing ripples in the otherwise highly-regimented process, which threw the agents off the track.

The `skylark` plugin is the successor: one pipeline, ephemeral expert
invocations, no persistent per-agent state to drift.

## License

MIT
