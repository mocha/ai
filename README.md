# mocha-ai

Mocha's Claude Code plugins. A small, curated set of tools
for running AI-assisted engineering workflows — expert reviews, autonomous
implementation pipelines, and usage reflection.

## 🐙 Plugins

| Plugin | What it does |
|---|---|
| [**skylark**](plugins/skylark/README.md) | Workflow v2: An autonomous-agent development pipeline that routes "expert" agents through a robust and risk-aware development workflow. Moves through bugs fast but slow-and-steady through load-bearing changes. |
| [**reflect**](plugins/reflect/README.md) | A reimagination of Claude's built-in `/insights` command, generating the same report but now using a hackable skill+script combo instead of hardcoded TS inside the harness. 😉 |
| [**llmstxt**](plugins/llmstxt/README.md) | Create and maintain `llms.txt` navigation files across large content vaults and provide agent-first directory maps that cut traversal tokens in deep knowledge bases. |

<details>

<summary>Retired plugins</summary>

| Plugin | What it does |
|---|---|
| [**experts**](plugins/experts/README.md) | Generate domain-specific expert reviewers on-the-fly using vocabulary routing based on [forge](https://github.com/jdforsythe/forge). Provides primitives for spec, plan, and code review; ripe for remixing. Superseded by `skylark`, above. |
| [**triad**](plugins/triad/README.md) | Three-agent (PM/PgM/EM) autonomous development framework coordinating via file-based inbox messages and orchestrated over tmux. Superseded by `experts`, above. |

</details>

---

## Install

Add the marketplace:

```bash
/plugin marketplace add mocha/ai
```

Then install desired plugins via `/plugins` TUI, or directly via command:

```bash
/plugin install <plugin-name>@mocha-ai
```

---

## [`skylark`](plugins/skylark/README.md) _(workflow v3 - Current)_

Skylark is a semi-autonomous agentic development pipeline featuring a detailed workflow that self-adjusts complexity based on the risk of the task at hand. This attempts to ensure high-quality output when performing high-risk work, but gracefully removes gates to maximize speed and token-efficiency when working on low-risk items. See [WORKFLOW.md](plugins/skylark/WORKFLOW.md) for the end-to-end pipeline walkthrough with diagrams and gate activation tables.

| Command | Purpose |
|---|---|
| `/skylark:implement <input>` | Single entry point — classifies input and routes through the pipeline |
| `/skylark:brainstorm` | Socratic design conversation, produces a spec |
| `/skylark:finish` | Close out a branch — verify, merge/PR/keep/discard, cleanup |
| `/skylark:panel-review <doc>` | Multi-expert parallel review of any document |
| `/skylark:solo-review <doc>` | Single expert review of any document |

> _**Notes:** This approach builds on what I learned from the [experts](plugins/experts/README.md) skill, using vocabulary routing to tailor the context window of each agent upon invocation, and reimagines (and vastly expands!) the development pipeline which was previously being managed by multiple agents in [triad](plugins/triad/README.md) and reworks it into a single thread to simplify communication._

---

### [`reflect`](plugins/reflect/README.md)

Claude's Insights tool is incredibly useful for helping you understand your own journey as you start to explore more complex usage. It helps you spot areas where you are potentially missing out on using advanced features and provides pointers on how to improve things that are already going well.

| Command | Purpose |
|---|---|
| `/reflect:self-reflection [window]` | Date-scoped usage report in the style of built-in `/insights` |

> _**Notes:** It achieves this by evaluating the stored history in your local Claude instance and applying a complex set of prompts to analyze that data. However, because of how it is constructed, you are unable to modify it or request changes to that analysis. For example, if you wanted to perform that analysis only against the previous 24 hours, it would be impossible._
>
> _By turning this feature into a /skill+script it becomes much more accessible and hackable for those inclined to tinker._

---

### [`llmstxt`](plugins/llmstxt/README.md)

| Command | Purpose |
|---|---|
| `/llmstxt:update [path]` | Scan for stale `llms.txt` nav files and regenerate them bottom-up (`--dry-run` to preview) |

---

# Retired plugins:

_These are no longer directly installable through the plugin, but they are included for manual use if you are interested in remixing them for your own purposes. EVERYTHING here is "use at your own risk," but the stuff below doubly-so._


## `experts` _(workflow v2)_

This model is a single-threaded flow that utilizes the techniques described in Forge to handle creation, quoting, and vocabulary routing. It also employs domain expert techniques to create customized prompts for each individual step in the task.

| Command | Purpose |
|---|---|
| `/expert:solo-review <doc>` | Single bespoke expert reviews a document |
| `/expert:panel-review <doc>` | 2-5 specialized experts review in parallel |
| `/expert:spec-review <SPEC>` | Iterative spec review with fix-and-re-review loop |
| `/expert:plan-review <PLAN>` | Decompose a plan into tasks, review each in isolation |
| `/expert:develop <TASK>` | Fresh expert executes a single task in a worktree |
| `/expert:implement <SPEC>` | Full pipeline: spec-review → plan → plan-review → per-task develop |

> _**Notes:** While this approach was quite effective and able to work through small and well-considered tasks well, it eventually needed to be expanded into a more robust workflow infrastructure to allow it to handle a wider range of options. This served as a good testbed, however, I quickly abandoned it in favor of `skylark`, which greatly elaborates on the idea._

---

### `triad` _(workflow v1)_

My original workflow uses TMUX sessions and multiple panes or windows to hold these three independent agents, which can then communicate with each other through the file system, effectively emailing each other with little purpose-built files. A file watcher triggers a "send keys" event to alert them of new messages, allowing rapid, observable, sychronous communication and collaboration between agents.

Agents follow a strict workflow that defines the artifacts they trade between each step, keeping them tightly on-rails and making their process repeatable and able to be iteratively improved.

| Command | Purpose |
|---|---|
| `/triad:start <org/repo> <path>` | Create tmux session, launch PM/PgM/EM agents |
| `/triad:kick <org/repo> [agent]` | Restart crashed or stuck agent(s) |
| `/triad:status <org/repo>` | Capture state of all panes and inboxes |
| `/triad:resume <org/repo>` | Reconnect to an existing session, verify agents |

> _**Notes:** Because of the nature of their communication protocol, usage of this workflow feels like reading the email threads of an ultra-idealized version of a dev team that only communicate in formal memos. It was bizarre and sometimes hilarious._
>
> _In practice, it regularly had communication breakdowns where one agent would not correctly interpret the signal that it was its turn to reply, or the file watcher would fire at a time when the Claude CLI didn't pick it up appropriately, etc. ... so to keep it autonomous, I ended up needing to add a **fourth** agent in another session, which could then monitor those Tmux sessions from the first three, and prod them along as things were falling._
