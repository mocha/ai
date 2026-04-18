# Pipeline Types

The Classifier assigns one of these types to each file. The type determines
which Decomposer processes the file downstream.

| Type | What it covers | Key signals |
|---|---|---|
| `personal-notes` | Meeting notes, braindumps, dictated thoughts, standups, 1:1s. **Includes agent-synthesized outputs from personal sessions:** session retrospectives, braindump syntheses, dictation summaries, research syntheses created as part of personal workflow. If the content originated from a person's thinking or meeting, it's personal-notes regardless of how polished the output is. | Attendee lists, action items, dates, personal pronouns, "session readout", "retrospective", informal tone, wiki-links to people |
| `customer-notes` | Notes from meetings or interactions WITH a customer or partner, focused on the relationship and their needs | External company names, attendees from multiple orgs, product feedback, requirements, contract details, "customer", "partner" |
| `customer-profile` | Structured descriptions of a company, customer, or competitor. The file DESCRIBES an entity — overview, capabilities, key facts — rather than recording interactions. | "Overview", "Key Facts", structured sections, funding data, capability tables, company metadata |
| `project-proposal` | Proposals, PRDs, program overviews, initiative briefs, product inputs. Content that PROPOSES action or advocates for building something. | "Product Inputs", "Proposal", problem statement, user stories, scope, sequencing, "we should build" |
| `article` | News articles, blog posts, press releases from external sources | Bylines, publication dates, forward-looking statements, media contacts, external URLs |
| `publication` | Research papers, whitepapers, technical reports with academic structure | Abstract, authors with affiliations, citations, index terms, methodology sections |
| `presentation` | Decks, slide exports, talk transcripts | "Slide 1", sequential slide structure, embedded images, speaker notes |
| `codebase-review` | Investigation reports examining a specific codebase — architecture analysis, code walkthroughs, feasibility assessments | Repository names, code snippets, file paths, function signatures, "investigation", "architecture" |
| `internal-document` | Memos, reports, design docs, strategy documents that RECORD institutional decisions or knowledge. NOT proposals (those are project-proposal), NOT notes (those are personal-notes). | "To/From" headers, formal structure, policy language, decision records, "approved by" |
| `docs-content` | Product documentation describing current system capabilities. What the product does today, written for external consumption. | API references, setup guides, feature descriptions, present-tense capability statements, product documentation sites |
| `structured-content` | Content previously curated as typed objects in another knowledge graph. Treated as a schema-matching exercise, not prose decomposition. | Source frontmatter has a `type:` field matching one of our graph schemas (`Feature`, `Product`, `Company`, `Persona`, `Job`, etc.); heavy structured frontmatter; body organized under predictable `## Section` headers that parallel schema sections; low prose-to-structure ratio |

## Source Trust

Content sources carry different levels of trust. These levels inform how
aggressively claims should be asserted and how much skepticism the Decomposer
should apply.

| Level | Description |
|---|---|
| `internal` | Created within the org. High trust. |
| `independent` | Third-party editorial content. Moderate trust. |
| `editorial` | Industry analysis and commentary. Variable trust. |
| `corporate-first-party` | Competitor blogs, product pages, marketing material. Skeptical. |
| `press-release` | Formal announcements. Maximum skepticism for qualitative claims. |

## Classification Principles

- Classify by **CONTENT and PURPOSE**, not by file location
- Agent-synthesized outputs are `personal-notes` if they originated from a person's session, meeting, or brainstorm — regardless of polish level
- When a file could be two types, classify by **PRIMARY PURPOSE**: does it CAPTURE thoughts, DESCRIBE an entity, PROPOSE action, or RECORD a decision?
- Files with fewer than 3 lines of body content always get `low` confidence
- If `source_trust` is already set in frontmatter, preserve it; if absent, infer from content signals
