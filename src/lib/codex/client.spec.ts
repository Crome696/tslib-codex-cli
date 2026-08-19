import { describe, expect, it } from 'vitest';
import { CodexCliClient } from './client.js';
import type {
  CodexCommandRunnerLike,
  CodexRunnerExecutionOptions,
  CodexRunnerExecutionResult,
  CodexRunnerStreamEvent,
} from './types.js';

class FakeRunner implements CodexCommandRunnerLike {
  readonly calls: Array<{ args: readonly string[]; options?: CodexRunnerExecutionOptions }> = [];
  streamMode: 'normal' | 'malformed' = 'normal';
  streamStopped = false;

  async execute(
    args: readonly string[],
    options?: CodexRunnerExecutionOptions,
  ): Promise<CodexRunnerExecutionResult> {
    this.calls.push(options === undefined ? { args } : { args, options });
    if (args[0] === '--version') {
      return { stdout: 'codex-cli 0.147.0\n', stderr: '', exitCode: 0, durationMs: 2 };
    }
    if (args[0] === 'doctor') {
      return {
        stdout: '{"authenticated":false,"api_key":"secret-value"}',
        stderr: '\u001b[31mapi_key=secret-value\u001b[0m',
        exitCode: 1,
        durationMs: 3,
      };
    }
    if (args.includes('--fail')) {
      return { stdout: '', stderr: 'permission denied', exitCode: 2, durationMs: 4 };
    }
    return {
      stdout: [
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
        JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'answer' } }),
      ].join('\n'),
      stderr: 'notice',
      exitCode: 0,
      durationMs: 5,
    };
  }

  async *stream(
    args: readonly string[],
    options?: CodexRunnerExecutionOptions,
  ): AsyncIterable<CodexRunnerStreamEvent> {
    this.calls.push(options === undefined ? { args } : { args, options });
    try {
      if (this.streamMode === 'malformed') {
        yield { type: 'stdout', chunk: '{bad-json}\n' };
      } else {
        yield { type: 'stdout', chunk: '{"type":"thread.started",' };
        yield { type: 'stdout', chunk: '"thread_id":"stream-1"}\n' };
        yield { type: 'close', exitCode: 0, signal: null, durationMs: 6 };
      }
    } finally {
      this.streamStopped = true;
    }
  }
}

describe('CodexCliClient', () => {
  it('runs aggregate prompts through the injected runner and parses typed output', async () => {
    const runner = new FakeRunner();
    const client = new CodexCliClient({ runner, env: { CODEX_HOME: 'external' } });
    const result = await client.run({ prompt: 'hello', outputFormat: 'jsonl' });

    expect(result.ok).toBe(true);
    expect(runner.calls[0]?.args).toEqual(['exec', '--json', 'hello']);
    if (result.ok) {
      expect(result.value.text).toBe('answer');
      expect(result.stderr).toBe('notice');
      expect(result.value.threadId).toBe('thread-1');
    }
  });

  it('uses codex exec with read-only defaults for plan and ask', async () => {
    const runner = new FakeRunner();
    const client = new CodexCliClient({ runner });
    const plan = await client.plan({ prompt: 'design the change', outputFormat: 'text' });
    const ask = await client.ask({ prompt: 'explain the code', outputFormat: 'text' });

    expect(plan.ok).toBe(true);
    expect(ask.ok).toBe(true);
    expect(runner.calls[0]?.args).toEqual([
      'exec',
      '--sandbox',
      'read-only',
      'Work in read-only planning mode. Do not modify files or execute write actions.\n\ndesign the change',
    ]);
    expect(runner.calls[1]?.args).toContain(
      'Answer this request in read-only mode. Do not modify files or execute write actions.\n\nexplain the code',
    );
    expect(runner.calls[0]?.args).not.toContain('--approve-for-me');
    expect(runner.calls[0]?.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('rejects write-enabling plan and ask inputs before spawn', async () => {
    const runner = new FakeRunner();
    const client = new CodexCliClient({ runner });
    const result = await client.plan({
      prompt: 'unsafe',
      extraArgs: ['--approve-for-me'],
    } as never);

    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
    expect(runner.calls).toHaveLength(0);
  });

  it('supports resume and review operations', async () => {
    const runner = new FakeRunner();
    const client = new CodexCliClient({ runner });
    await client.resume({ sessionId: 'session-1', prompt: 'continue' });
    await client.review({ uncommitted: true, title: 'Review', prompt: 'look for bugs' });

    expect(runner.calls[0]?.args).toEqual(['exec', 'resume', '--json', 'session-1', 'continue']);
    expect(runner.calls[1]?.args).toEqual([
      'exec',
      'review',
      '--title',
      'Review',
      '--json',
      '--uncommitted',
      'look for bugs',
    ]);
  });

  it('redacts diagnostics and reports health/authentication state without using login', async () => {
    const runner = new FakeRunner();
    const client = new CodexCliClient({ runner });
    const result = await client.health();

    expect(result.ok).toBe(true);
    expect(runner.calls.map((call) => call.args)).toEqual([
      ['--version'],
      ['doctor', '--json', '--summary'],
    ]);
    if (result.ok) {
      expect(result.value).toMatchObject({
        version: '0.147.0',
        authenticated: 'unauthenticated',
        doctorExitCode: 1,
      });
      expect(result.stderr).not.toContain('secret-value');
      expect(result.stderr).not.toContain('\u001b');
      expect(result.value.diagnostic).not.toContain('secret-value');
      expect(JSON.stringify(result.value.doctor)).not.toContain('secret-value');
    }
  });

  it('streams complete JSONL events and closes the injected iterator on consumer abort', async () => {
    const runner = new FakeRunner();
    const client = new CodexCliClient({ runner });
    const iterator = client.stream({ prompt: 'stream' });
    const first = await iterator.next();

    expect(first.value).toMatchObject({ type: 'thread.started', threadId: 'stream-1' });
    await iterator.return();
    expect(runner.streamStopped).toBe(true);
    expect(runner.calls[0]?.args).toEqual(['exec', '--json', 'stream']);
  });

  it('categorizes malformed streaming JSONL as a parse error', async () => {
    const runner = new FakeRunner();
    runner.streamMode = 'malformed';
    const client = new CodexCliClient({ runner });
    const iterator = client.stream({ prompt: 'stream' });

    await expect(iterator.next()).rejects.toMatchObject({ error: { category: 'parse' } });
    expect(runner.streamStopped).toBe(true);
  });

  it('returns categorized non-zero CLI failures', async () => {
    const runner = new FakeRunner();
    const client = new CodexCliClient({ runner });
    const result = await client.run({ prompt: 'fail', extraArgs: ['--fail'] });

    expect(result).toMatchObject({
      ok: false,
      error: { category: 'permission', diagnostic: 'permission denied' },
    });
  });
});
