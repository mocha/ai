---
# Inbox Message — used for inter-agent communication
# Copy this template and fill in all fields relevant to the message type.

type:            # question | decision | status-update | escalation | approval-request
from:            # Sending agent (product-manager | program-manager | engineering-manager)
to:              # Receiving agent
disposition:     # pending | acknowledged | resolved | expired
references: []   # List of related document paths or URLs
proposal:        # Related proposal ID (PMD-NNN) if applicable
project:         # Related project ID (PRJ-NNN) if applicable
task:            # Related task ID (T-NNN) if applicable
round:           # Communication round number for multi-turn exchanges
timestamp:       # ISO 8601 timestamp when the message was created
urgency:         # low | normal | high | critical
reason:          # Brief reason the message was sent (one line)
---

## Summary

<!-- One-paragraph overview of the message. The receiving agent should be able to
     decide whether to act immediately or defer based on this section alone. -->

## Detail

<!-- Full context, data, or rationale supporting the message. Include specific
     questions, options under consideration, or decisions made. -->
