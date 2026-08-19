import { describe, expect, it } from 'vitest';
import { CodexCommandRunner } from './command-runner.js';

describe('CodexCommandRunner', () => {
  it('spawns without a shell and preserves argument boundaries', async () => {
    const runner = new CodexCommandRunner({ executable: process.execPath });
    const result = await runner.execute([
      '-e',
      'process.stdout.write(process.argv[1] ?? "")',
      '& literal',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('& literal');
  });

  it('writes optional stdin and captures non-zero exits', async () => {
    const runner = new CodexCommandRunner({ executable: process.execPath });
    const result = await runner.execute(
      [
        '-e',
        'process.stdin.setEncoding("utf8");let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(s));',
      ],
      { stdin: 'stdin payload' },
    );
    const failed = await runner.execute(['-e', 'process.stderr.write("failed");process.exit(3)']);

    expect(result.stdout).toBe('stdin payload');
    expect(failed.exitCode).toBe(3);
    expect(failed.stderr).toBe('failed');
  });

  it('maps missing executables, timeout, and abort to categorized runner errors', async () => {
    const missing = new CodexCommandRunner({ executable: 'codex-executable-that-does-not-exist' });
    await expect(missing.execute([])).rejects.toMatchObject({ kind: 'cli_unavailable' });

    const runner = new CodexCommandRunner({ executable: process.execPath });
    await expect(
      runner.execute(['-e', 'setTimeout(() => {}, 1000)'], { timeoutMs: 20 }),
    ).rejects.toMatchObject({
      kind: 'timeout',
    });

    const controller = new AbortController();
    const pending = runner.execute(['-e', 'setTimeout(() => {}, 1000)'], {
      signal: controller.signal,
      timeoutMs: 5000,
    });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('streams stdout chunks and closes the child process', async () => {
    const runner = new CodexCommandRunner({ executable: process.execPath });
    const events = [];
    for await (const event of runner.stream([
      '-e',
      'process.stdout.write("first");setTimeout(()=>process.stdout.write("second"),5)',
    ])) {
      events.push(event);
    }

    expect(
      events
        .filter((event) => event.type === 'stdout')
        .map((event) => event.chunk)
        .join(''),
    ).toBe('firstsecond');
    expect(events.at(-1)).toMatchObject({ type: 'close', exitCode: 0 });
  });
});
