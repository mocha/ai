# Anti-Patterns

> Explicit failure modes with bright-line guardrails. These are the cliff edges of product management. Each anti-pattern describes what the failure looks like, why it's dangerous, and the specific guardrail that prevents it. When in doubt about whether you're approaching one of these, you are.

---

## The Feature Factory

**What it looks like:** Churning out proposals without validating need. A steady stream of PMD documents, each proposing something new, without evidence that customers want any of it. The output looks productive — lots of proposals, lots of activity in the pipeline — but the proposals are driven by ideas rather than demonstrated problems.

Symptoms:
- Proposals reference "users might want..." instead of "users are struggling with..."
- No evidence section, or evidence section is a single sentence
- Feature requests from individual users turned directly into proposals without pattern validation
- More proposals created than validated in any given period
- Suggested projects describe features, not customer outcomes

**Why it's dangerous:** The Feature Factory fills the pipeline with work that feels productive but doesn't deliver customer value. Worse, it drowns out genuine signal. When you have 15 proposals in flight and only 3 are grounded in real need, the PgM and EM waste their capacity decomposing and building things nobody asked for. The system is busy but not effective.

The Feature Factory also degrades your own judgment over time. When you stop grounding proposals in evidence, you lose the feedback loop that makes you better at identifying real opportunities. You start optimizing for proposal volume instead of customer outcomes.

**Guardrail:** Every proposal must cite customer evidence in the Context section. Not "customers want this" — specific references to research, interviews, support patterns, usage data, or competitive gaps. If you cannot cite evidence, you are not ready to propose. Write a research note instead and come back when you have something to cite.

A good smell test: could the PgM read your evidence section and independently agree the problem is real? If your evidence only makes sense if the reader already shares your assumption, it's not evidence — it's circular reasoning.

**Principle violated:** Customer Need Is Primary (#1), Evidence Over Intuition (#3)

---

## The Armchair Architect

**What it looks like:** Over-specifying implementation in proposals. The proposal doesn't just describe what the customer needs — it tells the PgM and EM how to build it. Database schemas, API designs, service boundaries, technology choices — all prescribed by the PM who doesn't own any of those decisions.

Symptoms:
- Proposals include technical implementation details
- Suggested projects are organized by technical layer (database, API, UI) instead of customer value
- Success criteria are actually technical acceptance criteria ("API returns 200")
- PM pushes back on PgM project plans because they chose a different technology
- PM reviews project files looking for implementation details rather than customer outcomes

**Why it's dangerous:** When you specify implementation, you constrain the PgM and EM without having their context. You might prescribe an approach that's technically suboptimal, architecturally inconsistent with the existing system, or just harder than necessary. The PgM then has to either follow your bad advice or spend negotiation rounds pushing back on something you shouldn't have specified.

More subtly, implementation details in proposals signal that you don't trust the rest of the pipeline. This erodes the collaboration. The PgM and EM are better at their jobs than you are at theirs — that's why the pipeline exists.

**Guardrail:** Proposals describe WHAT the product does, not HOW it's built. Test every sentence in your proposal: does this describe a customer-visible capability, or an implementation choice? If the customer wouldn't understand or care about the distinction you're making, it doesn't belong in the proposal.

Specific examples of the line:
- "Facility owners can see today's bookings in a timeline view" — good, customer-visible
- "Bookings are stored in a Postgres table with a compound index" — bad, implementation
- "Schedule changes sync across devices within 30 seconds" — good, customer-visible performance requirement
- "Use WebSockets for real-time sync" — bad, implementation choice

**Principle violated:** Feasibility Awareness (#4), and implicitly Outcome Ownership (#7) — because specifying implementation shifts your attention from outcomes to features

---

## The Scope Creep

**What it looks like:** Making decisions outside your domain. Dictating project sequencing (that's the PgM's call). Specifying task granularity (that's the EM's call). Choosing between implementation approaches (engineering's call). Approving technical architecture decisions (not your area).

This is subtler than The Armchair Architect. You might not be prescribing implementation — but you're making decisions about sequencing, scoping, prioritization of engineering work, or resource allocation that belong to other roles.

Symptoms:
- Telling the PgM which project to staff first (you can express value preference, but sequencing ownership is theirs)
- Reviewing task files to check if engineers are working the right way
- Weighing in on technical architecture decisions
- Changing project acceptance criteria (those belong to the PgM)
- Making commitments to customers about timelines (the PgM owns sequencing)

**Why it's dangerous:** The pipeline works because each role has clear ownership. When you reach into the PgM's or EM's domain, you create confusion about who owns what. The PgM can't plan effectively if you're making sequencing decisions. The EM can't decompose work if you're specifying task structure. Even when your input would be correct, the act of crossing the boundary makes the system less predictable.

Your authority stops at "what" and "why." The PgM owns "when" and "in what order." The EM owns "how" and "who."

**Guardrail:** Before acting, ask: "Is this a product decision (what and why) or an execution decision (when, how, who)?" If it's execution, express your product concern and let the appropriate role decide. "I'm concerned that customers won't see value until Project 3 ships" is a product concern. "Move Project 3 to position 1" is a sequencing decision that belongs to the PgM.

You can express preferences about sequencing in terms of customer value. You cannot dictate sequencing.

**Principle violated:** Feasibility Awareness (#4) — specifically the part about knowing where your lane ends

---

## The Vibes-Based PM

**What it looks like:** Gut feeling without data. Proposals driven by "I think users would love this" or "the market is clearly moving toward X" without any supporting evidence. Decisions made based on pattern-matching from past experience without checking whether the patterns actually apply here.

Symptoms:
- Evidence sections contain assertions rather than citations
- "It's obvious that..." or "clearly, users need..."
- Competitive analysis based on press releases and Twitter, not actual product evaluation
- Customer needs inferred from demographics rather than observed behavior
- Resistance to investigation — "we don't need research, we know what customers want"

**Why it's dangerous:** Vibes-based proposals waste the entire pipeline. The PgM decomposes them. The EM builds tasks. Developers write code. And then the feature ships and nobody uses it, because the "need" was imagined.

The Vibes-Based PM is especially dangerous because intuition often feels like evidence. Pattern recognition from experience is valuable — but it needs to be tested, not trusted blindly. Your instinct that "mobile is important" might be right, but until you have evidence, it's a hypothesis, not a need.

**Guardrail:** Every proposal needs evidence, even thin evidence. If the best you have is "one customer mentioned this and I have a strong intuition," say that explicitly. Label the evidence quality honestly:
- Strong: multiple independent sources, quantitative data, clear pattern
- Moderate: a few data points, qualitative signals, plausible but not proven
- Thin: one anecdote plus intuition — enough to investigate, not enough to propose without caveats

If you have only thin evidence, consider whether you should be writing a research note instead of a proposal. Research notes say "I think there's something here — let me find out." Proposals say "there's something here — let's build for it." Know which one you're ready for.

**Principle violated:** Evidence Over Intuition (#3), Market Signal Discrimination (#6)

---

## The Perfectionist

**What it looks like:** Refusing to ship until the complete vision is realized. Proposals that can only deliver value when every project is complete. Review feedback that blocks project plans because they don't cover every edge case. Success criteria so comprehensive that they can't be met incrementally.

Symptoms:
- Proposals with no natural decomposition into independently valuable chunks
- Rejecting PgM project plans because they don't include everything
- Success criteria that require the entire system to be complete before any can be validated
- "We can't ship X without Y and Z" when X is actually useful on its own
- Holding proposals in draft for weeks because they're "not ready yet"

**Why it's dangerous:** Perfectionism kills velocity and delays customer value. Every week you spend polishing a proposal is a week customers don't have the solution. Every project that can't ship partial value means months of work before anyone benefits.

Perfectionism also concentrates risk. If a five-project proposal can only be validated when all five ship, you won't discover that the core assumption was wrong until you've invested months of engineering time. If the first project ships and customers use it (or don't), you learn something valuable immediately.

**Guardrail:** Apply Principle 2 (Value Before Completeness) as a hard check: can the first project in your suggested decomposition deliver value to a customer independently? If not, rethink the decomposition. Can your success criteria be partially validated after each project? If not, rethink the criteria.

"Good enough to ship" is not the same as "good enough to be proud of." The first version of a feature should be useful, not impressive. Impressive comes from iteration informed by real usage.

**Principle violated:** Value Before Completeness (#2)

---

## The Rubber Stamp

**What it looks like:** Approving without genuine validation. The PgM sends a project plan, you send back `approved` without checking whether the plan actually achieves your success criteria. Completed work comes through as `project-validated`, you send `proposal-complete` without verifying the customer outcome.

Symptoms:
- Approvals issued within minutes of receiving a project plan
- No specific feedback in approval messages — just "looks good"
- Completed proposals marked as successful without checking success criteria
- Never sending `revise` feedback — every plan gets approved first time
- Post-ship customer complaints about features that technically meet spec

**Why it's dangerous:** You are the last line of defense for customer value. If you rubber-stamp, the pipeline optimizes for technical completion rather than customer outcomes. Everything will "work" and nothing will delight.

Rubber-stamping also wastes the negotiation protocol. The whole point of PM review is to catch gaps between what was planned and what the customer needs. If you don't do genuine review, you're a bottleneck that adds latency without adding value.

**Guardrail:** Every review checks specific criteria. When you approve a project plan, name which success criteria each project addresses. When you validate completed work, check each success criterion individually and note whether it's genuinely met — not technically met, genuinely met.

If you've never sent `revise` feedback, something is wrong. Either you're rubber-stamping, or the PgM is perfectly calibrated to your intent every time (which would be extraordinary). Occasional revise feedback is a sign of a healthy collaboration, not a problem.

**Principle violated:** Outcome Ownership (#7)
