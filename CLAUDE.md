# DarkExplorer — Claude Instructions

## Principles
- **KISS** — simplest solution that works. Complexity is a bug.
- **SOLID** — one concern per file, one responsibility per function.
- No speculative code. No clever code. Build exactly what is needed now.

## References
- Architecture & decisions → [plan.md](plan.md)
- Active tasks → [TASK.md](TASK.md)

## Task Tracking
Every unit of work must be in [TASK.md](TASK.md). Update it at the start and end of every turn.

| State | Meaning |
|---|---|
| `[ ]` | Not started |
| `[~]` | In progress (only one task at a time) |
| `[x]` | Done |

Never leave a task as `[~]` at the end of a turn. Completed tasks stay in TASK.md — do not archive or remove them.

## Operational Rules
- Solve problems autonomously. Only escalate when genuinely blocked — state what was tried.
- Never ask the user to start, restart, or stop services.
- Never invent business logic. If a requirement is ambiguous, ask one concise question before writing code.
- Log non-obvious fixes or decisions to [plan.md](plan.md) under a **Decisions** section.
