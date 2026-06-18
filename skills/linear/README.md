# linear — Pi skill

Thin Bun CLI wrapping `@linear/sdk` for read + draft-gated mutation of Linear issues. Follows the project's `--i-approve` idiom: reads are immediate, mutations require an explicit flag and produce a forensic JSONL audit log at `.pi/.linear-log.jsonl` (mode 0600, gitignored).

See `SKILL.md` for the full command reference, example invocations, and payload shapes. The sections below are for the human reader wandering in.

## Shape

```
linear/
  SKILL.md                 # model-facing capability doc
  README.md                # this file
  bin/linear.ts            # Bun CLI, exports dispatch(argv, opts)
  test/linear.test.ts      # unit tests (mocked client) + [live] tests gated on LINEAR_TESTS_LIVE=1
```

## Authentication

`LINEAR_API_KEY` in the environment. If missing, the CLI exits non-zero and prints the exact export command to add to `~/.bashrc`.

## Commands at a glance

| Command | Mutation? | Behavior without `--i-approve` |
|---|---|---|
| `list` | no | returns immediately |
| `get <KEY>` | no | returns immediately |
| `comment <KEY> <body>` | yes | prints preview, exits 0 |
| `transition <KEY> <state>` | yes | resolves state ID, prints diff, exits 0 |
| `create --team=… --title=…` | yes | prints payload preview, exits 0 |

## Testability

`bin/linear.ts` exports `dispatch(argv, opts)` where `opts.linearClientFactory` is injectable. Tests mock the client and assert on the dispatcher's I/O; the production CLI wrapper at the bottom of the file wires in the real `LinearClient`.

## Live tests

`LINEAR_TESTS_LIVE=1 bun run test:live` runs the `[live]` smoke tests against the real Linear API. Skipped by default.

## Audit log schema

One JSONL line appended per approved mutation:

```json
{"ts":"<ISO>","action":"<cmd>","key":"<KEY>","before":{...},"after":{...},"approver":"luci"}
```

Log path `.pi/.linear-log.jsonl` is gitignored and created mode 0600.
