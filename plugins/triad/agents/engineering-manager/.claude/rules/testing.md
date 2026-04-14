---
paths:
  - "src/**"
  - "tests/**"
---
# Testing Rules

- Write tests FIRST for each acceptance criterion
- Confirm tests FAIL before implementing (proves tests actually test something)
- Implement the minimum code to make tests pass
- Run the full test suite before committing
- If ANY test fails, fix before proceeding — do not skip or disable tests
- Design test output for clarity — terse summaries with clear error markers
- Never mock the database for integration tests unless the task explicitly says to
