# `claude/` — working context for this repo

Written 2026-09-18 at the owner's request. Nothing here is read by the application;
it is for whoever (person or model) picks the work up next.

| | |
|---|---|
| **`Claude-Context.md`** | **Start here.** Everything worked on in the 17–18 Sept session: what changed, why, what was found on the way, and what is still open. |
| `memory/` | The 23-entry project memory, copied from the per-project store. `MEMORY.md` is its index. Durable facts about Pacific's systems — read before making assumptions about the fab model, `polish_qc` semantics, the Neon database or the commercial decisions. |
| `claude-mem-export.json` | What the `claude-mem` plugin held. Almost nothing — see below. |

## On claude-mem and graphify

Both were checked, and the honest answer is that neither had project data worth copying:

- **claude-mem** (`~/.claude-mem`, 19 MB) is a stale install last written 10 August.
  `observations` = 0 rows, `session_summaries` = 0 rows, and **0 of its 102 stored prompts
  mention this project**. Only one session row and a few sync-queue entries referenced it at
  all, and those are exported. Copying the 19 MB would have added noise, not context.
- **graphify** has no stored data on this machine — the skill is installed, nothing is written.
- **CodeGraph** indexes this repo but keeps its index outside it (no `.codegraph/` here), so
  there is nothing local to copy. It rebuilds itself from the source.

The memory in `memory/` is the real thing and is current.
