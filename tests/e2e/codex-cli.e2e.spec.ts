import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { CodexCliClient } from '../../src/index.js';
import type { CodexEvent, CodexHealth, CodexParsedOutput, CodexResult } from '../../src/index.js';

const execFile = promisify(execFileCallback);
const TEST_TIMEOUT_MS = 180_000;

describe.sequential('local Codex CLI E2E', () => {
  const client = new CodexCliClient({ timeoutMs: TEST_TIMEOUT_MS });
  let health: CodexHealth | undefined;
  let sessionId: string | null = null;

  beforeAll(async () => {
    const healthResult = expectSuccess(await client.health(), 'health');
    health = healthResult;

    if (!healthResult.available) {
      throw new Error(
        'The Codex CLI is not available. Install `codex` and retry `npm run test:e2e`.',
      );
    }

    if (healthResult.authenticated === 'unauthenticated') {
      throw new Error(
        'The Codex CLI is not authenticated. Complete the CLI login flow and retry `npm run test:e2e`.',
      );
    }
  }, TEST_TIMEOUT_MS);

  it('reports the real CLI version and health state', () => {
    if (health === undefined) {
      throw new Error('The Codex CLI health preflight did not complete.');
    }

    expect(health.available).toBe(true);
    expect(health.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(health.authenticated).not.toBe('unauthenticated');
  });

  it('runs a read-only request through the real codex exec command', async () => {
    const output = expectSuccess(
      await client.run({
        prompt:
          'Reply with a short confirmation. Do not inspect, create, modify, or execute anything in the working tree.',
        sandbox: 'read-only',
        outputFormat: 'jsonl',
      }),
      'run',
    );

    expect(output.format).toBe('jsonl');
    expectLifecycleEvents(output.events, 'run');

    if (output.threadId === null || output.threadId.length === 0) {
      throw new Error('The real `run()` call did not return a session thread ID for `resume()`.');
    }
    sessionId = output.threadId;
  });

  it('runs the read-only plan convenience operation', async () => {
    const output = expectSuccess(
      await client.plan({
        prompt: 'Describe the public client API in a short read-only response.',
        outputFormat: 'text',
      }),
      'plan',
    );

    expectTextOutput(output, 'plan');
  });

  it('runs the read-only ask convenience operation', async () => {
    const output = expectSuccess(
      await client.ask({
        prompt: 'Explain what this E2E suite is validating in a short read-only response.',
        outputFormat: 'text',
      }),
      'ask',
    );

    expectTextOutput(output, 'ask');
  });

  it('resumes the session returned by the real run operation', async () => {
    if (sessionId === null) {
      throw new Error('The `run()` E2E operation did not provide a session ID for `resume()`.');
    }

    const output = expectSuccess(
      await client.resume({
        sessionId,
        prompt: 'Continue briefly and confirm that this is a resumed read-only turn.',
        outputFormat: 'text',
      }),
      'resume',
    );

    expectTextOutput(output, 'resume');
  });

  it('reviews a deterministic uncommitted change in a temporary Git fixture', async () => {
    const fixtureDirectory = await createReviewFixture();

    try {
      const reviewClient = new CodexCliClient({
        cwd: fixtureDirectory,
        timeoutMs: TEST_TIMEOUT_MS,
      });
      const output = expectSuccess(
        await reviewClient.review({
          uncommitted: true,
          title: 'Review the temporary E2E fixture change',
          outputFormat: 'text',
        }),
        'review',
      );

      expectTextOutput(output, 'review');
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it('streams normalized lifecycle events from the real CLI', async () => {
    const events: CodexEvent[] = [];
    for await (const event of client.stream({
      prompt:
        'Reply with a short confirmation through a read-only stream. Do not inspect or modify files.',
      sandbox: 'read-only',
    })) {
      events.push(event);
    }

    expectLifecycleEvents(events, 'stream');
  });
});

function expectSuccess<T>(result: CodexResult<T>, operation: string): T {
  if (result.ok) {
    return result.value;
  }

  const diagnostic = result.error.diagnostic ?? result.stderr;
  const suffix = diagnostic.length === 0 ? '' : `\nDiagnostic: ${diagnostic}`;
  throw new Error(
    `${operation} failed with ${result.error.category}: ${result.error.message}.${suffix}`,
  );
}

function expectTextOutput(output: CodexParsedOutput, operation: string): void {
  expect(output.format, `${operation} should return text output`).toBe('text');
  expect(output.text?.trim(), `${operation} should return a non-empty response`).toBeTruthy();
}

function expectLifecycleEvents(events: readonly CodexEvent[], operation: string): void {
  expect(
    events.some((event) => event.type === 'thread.started'),
    `${operation} should emit thread.started`,
  ).toBe(true);
  expect(
    events.some((event) => event.type === 'turn.completed'),
    `${operation} should emit turn.completed`,
  ).toBe(true);
  expect(
    events.some((event) => event.type === 'turn.failed'),
    `${operation} should not emit turn.failed`,
  ).toBe(false);
}

async function createReviewFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tslib-codex-cli-e2e-review-'));
  const targetFile = join(directory, 'review-target.md');

  try {
    await runGit(directory, ['init', '--quiet']);
    await runGit(directory, ['config', 'user.name', 'tslib-codex-cli-e2e']);
    await runGit(directory, ['config', 'user.email', 'tslib-codex-cli-e2e@example.invalid']);
    await writeFile(targetFile, '# Review fixture\n', 'utf8');
    await runGit(directory, ['add', 'review-target.md']);
    await runGit(directory, ['commit', '--quiet', '-m', 'Create review fixture']);
    await writeFile(
      targetFile,
      '# Review fixture\n\nThis line is intentionally uncommitted.\n',
      'utf8',
    );
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function runGit(cwd: string, args: readonly string[]): Promise<void> {
  await execFile('git', [...args], { cwd, windowsHide: true });
}
