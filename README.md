# tslib-codex-cli

`tslib-codex-cli` is a standalone, dependency-free TypeScript client for the installed Codex CLI's non-interactive headless surface. It invokes `codex exec`, `codex exec resume`, and `codex exec review` through a shell-free Node.js process boundary and normalizes text and JSONL output into typed results.

The package targets Node.js 22 or newer and publishes ESM, CommonJS, and TypeScript declaration files.

## Installation

```sh
npm install tslib-codex-cli
```

Codex must be installed separately and available as `codex` on `PATH` (or supplied as an explicit executable). The Codex CLI must also be authenticated separately when the selected provider requires it. This library never accepts, stores, prints, or manages API keys, access tokens, login sessions, or other credentials.

## ESM

```ts
import { CodexCliClient } from 'tslib-codex-cli';

const client = new CodexCliClient();
const result = await client.run({
  prompt: 'Summarize the repository architecture.',
});

if (result.ok) {
  console.log(result.value.text);
} else {
  console.error(result.error.category, result.error.message);
}
```

Aggregate operations request typed JSONL by default. Select `outputFormat: 'text'` when the raw text response is preferred.

## CommonJS

```js
const { CodexCliClient } = require('tslib-codex-cli');

async function main() {
  const client = new CodexCliClient({ executable: 'codex' });
  const result = await client.ask({
    prompt: 'Explain the public API without changing files.',
    outputFormat: 'text',
  });

  if (result.ok) {
    console.log(result.value.text);
  }
}

main().catch(console.error);
```

## Operations

### Direct execution

`run()` maps to `codex exec`. Known current flags are typed and ordered deterministically. This includes models, images, profiles, config overrides, feature toggles, provider selection, sandbox and approval controls, working directories, additional directories, ephemeral/config/rules switches, output schema, color, last-message output, JSONL, and explicit `extraArgs` for version-specific forward compatibility.

```ts
const result = await client.run({
  prompt: 'Implement the requested change.',
  model: 'gpt-5-codex',
  sandbox: 'workspace-write',
  cwd: './project',
  addDirs: ['./shared-fixtures'],
  outputFormat: 'jsonl',
});
```

Write-enabling and bypass options are available only through the explicit `run()` API. Use them only when the surrounding application has an independent safety boundary.

When `prompt` is `'-'`, Codex reads the prompt from stdin. The optional `stdin` property can supply that content; supplying stdin together with a normal prompt follows the Codex CLI behavior of appending a stdin block.

### Read-only plan and ask

`plan()` and `ask()` are convenience methods over `codex exec`, not invented Codex subcommands. They add a read-only instruction prefix and default to `--sandbox read-only`. Approval, bypass, additional-writable-directory, and write-enabling config arguments are rejected before spawn.

```ts
const plan = await client.plan({
  prompt: 'Propose an implementation plan for the issue.',
});

const answer = await client.ask({
  prompt: 'What does this module do?',
  outputFormat: 'text',
});
```

### Resume

`resume()` maps to `codex exec resume` and requires either a session id or `last: true`. `all: true` disables the CLI's working-directory filtering.

```ts
const result = await client.resume({
  sessionId: '00000000-0000-0000-0000-000000000000',
  prompt: 'Continue from the previous turn.',
});
```

### Review

`review()` maps to `codex exec review`. Review targets are mutually exclusive.

```ts
const result = await client.review({
  uncommitted: true,
  title: 'Review current changes',
  prompt: 'Focus on correctness and regressions.',
});
```

Use `base` or `commit` instead of `uncommitted` for the other current CLI review targets.

### JSONL streaming

`stream()` always requests JSONL and yields normalized lifecycle and item events as complete lines arrive. Unknown future event types are returned as `type: 'unknown'` with their original `raw` payload.

```ts
for await (const event of client.stream({ prompt: 'Inspect the repository read-only.' })) {
  if (event.type === 'item.completed') {
    console.log(event.item.type);
  }
}
```

Stopping or aborting the async iteration closes the underlying child process. Pass an `AbortSignal` and `timeoutMs` through the operation input when the process must have an explicit lifetime.

### Health

`health()` runs `codex --version` and the redacted `codex doctor --json --summary` diagnostic path. It does not run login, change authentication state, or send a model request.

```ts
const health = await client.health();
if (health.ok) {
  console.log(health.value.version, health.value.authenticated);
}
```

Diagnostic output is ANSI-stripped, length-limited, and redacted for common API-key, token, password, secret, and bearer-value forms. Environment overlays are passed only to the child process and are never copied into returned results or error diagnostics.

## Process and testing model

The production runner uses `node:child_process.spawn` with an argument array and `shell: false`. It captures stdout, stderr, exit status, and duration; handles timeout and abort cleanup; supports stdin; and keeps Windows command shims in an explicit executable-resolution path. `CodexCommandRunnerLike` can be injected into `CodexCliClient` so tests never need an installed or authenticated Codex CLI.

The parser recognizes the current `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.started`, `item.updated`, `item.completed`, and `error` event families. Typed item projections cover agent messages, reasoning, command execution, file changes, MCP and collaboration tool calls, web search, todo lists, and item errors. Malformed or empty JSONL is a categorized parse failure rather than an empty success.

## Compatibility and scope

The compatibility target is the current non-interactive `codex exec` CLI contract. `extraArgs` is an explicit, array-based escape hatch for flags introduced by a newer CLI version; it never enables shell interpolation. The installed CLI remains responsible for authentication, credential storage, provider policy, permissions, and model availability.

This package does not implement the interactive TUI, `codex app-server`/JSON-RPC, ACP, login or credential management, MCP/plugin/skill administration, hooks, daemons, subagents, or cloud APIs. Those surfaces are separate follow-up work.

## Development

The default checks are offline and do not make authenticated Codex calls:

```sh
npm ci
npm run typecheck
npm test
npm run lint
npm run format:check
npm run build
npm run pack:check
git diff --check
```

The local E2E suite runs against the real `codex` executable and is intentionally separate from the offline checks. Before running it, install and authenticate the Codex CLI locally and ensure that network access is available. The suite uses read-only prompts, performs real model requests, and is not part of CI:

```sh
npm run test:e2e
```

If the Codex CLI is missing or not authenticated, `npm run test:e2e` fails with an actionable diagnostic instead of silently skipping the suite. The normal `npm test` command remains offline and does not invoke Codex.
