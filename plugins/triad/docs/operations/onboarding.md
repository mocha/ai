# Project Onboarding Guide

How to onboard a new project to the agent triad.

## 1. Initialize Project Structure

Run the init script against your target project repository:

```bash
cd /path/to/ai-toolkit
./scripts/init-project.sh /path/to/your-project
```

This creates the full `docs/` directory structure the agents need: `proposals/`, `projects/`, `tasks/`, and `inbox/` directories for each agent role plus a human inbox.

Commit the scaffolding:

```bash
cd /path/to/your-project
git add docs/
git commit -m "Initialize agent triad infrastructure"
```

## 2. Create Context Files

Each agent needs a project-specific context file so it knows what it's working on. Create one per agent using the template:

```bash
cd /path/to/ai-toolkit

# Create context directories if they don't exist
mkdir -p agents/product-manager/context
mkdir -p agents/program-manager/context
mkdir -p agents/engineering-manager/context

# Copy the template for each agent
cp templates/project-context.md agents/product-manager/context/your-project.md
cp templates/project-context.md agents/program-manager/context/your-project.md
cp templates/project-context.md agents/engineering-manager/context/your-project.md
```

Fill in the frontmatter (`project`, `repo_path`, `domain`) and the sections in each file. Each agent needs different emphasis:

### Product Manager Context

Focus on the business and user side:

- **Domain Summary** -- What the product does, who the customers are, what stage it's at
- **Key Navigation** -- Where to find existing research, PRDs, competitive analysis, and the Obsidian vault if applicable
- **Active Work** -- Current product priorities, open questions, pending decisions
- **Project-Specific Notes** -- Customer segments, market context, known user pain points, stakeholder preferences

### Program Manager Context

Focus on coordination and constraints:

- **Domain Summary** -- What the project is, team structure, delivery cadence
- **Architecture Summary** -- High-level system design, major components, deployment model
- **Key Navigation** -- Where to find roadmap, architecture docs, decision logs
- **Active Work** -- Current priorities, blocked items, cross-cutting concerns
- **Project-Specific Notes** -- Known constraints, risk areas, team conventions, escalation preferences

### Engineering Manager Context

Focus on the codebase and technical execution:

- **Domain Summary** -- What the system does at a technical level
- **Architecture Summary** -- Tech stack, major services/modules, data flow, infrastructure
- **Key Navigation** -- Entry points for the codebase, test suites, CI config, deployment scripts
- **Active Work** -- Current tasks, PRs in flight, technical debt items
- **Project-Specific Notes** -- Coding conventions, test patterns, database conventions, deployment gotchas, known flaky areas

You don't need to fill in everything perfectly on day one. The agents will flesh out their context files as they learn the project.

## 3. Symlink Human Inbox (Optional)

For convenient access to escalations and status updates, symlink the human inbox to your home directory:

```bash
ln -s /path/to/your-project/docs/inbox/human ~/inbox
```

Now you can check `~/inbox/unread/` to see anything the agents need from you.

## 4. First Session

Start the agents using the [session startup guide](session-startup.md). For the first session, tell each agent to explore the project and update its context file:

**Product Manager:**
> You are working on your-project at /path/to/your-project. Your project context file is at agents/product-manager/context/your-project.md. Explore the project -- look at docs, README, any existing research or specs -- and flesh out your context file with what you learn.

**Program Manager:**
> You are working on your-project at /path/to/your-project. Your project context file is at agents/program-manager/context/your-project.md. Explore the project -- look at architecture docs, the codebase structure, any roadmap or planning docs -- and flesh out your context file.

**Engineering Manager:**
> You are working on your-project at /path/to/your-project. Your project context file is at agents/engineering-manager/context/your-project.md. Explore the codebase -- look at the tech stack, test setup, CI config, coding patterns -- and flesh out your context file.

After the first session, review the context files the agents produced. Correct anything off-base and add details they missed.

## 5. Iterate

Context files improve with each session as agents encounter new parts of the project. Periodically:

- Review context files for accuracy and completeness
- Add notes about decisions made, conventions adopted, or lessons learned
- Remove stale information about completed work or resolved issues
- Compare context files across agents to ensure consistency on shared facts (architecture, priorities)

The goal is for each agent to be able to pick up a fresh session, read its context file, and be productive within minutes.
