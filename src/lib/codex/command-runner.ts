import { spawn, type ChildProcess } from 'node:child_process';
import { CodexCommandRunnerError } from './runner-error.js';
import { validateTimeout } from './validation.js';
import type {
  CodexCommandRunnerLike,
  CodexRunnerExecutionOptions,
  CodexRunnerExecutionResult,
  CodexRunnerStreamEvent,
} from './types.js';

export interface CodexCommandRunnerOptions {
  readonly executable?: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
}

export class CodexCommandRunner implements CodexCommandRunnerLike {
  readonly executable: string;

  private readonly cwd: string | undefined;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly timeoutMs: number;

  constructor(options: CodexCommandRunnerOptions = {}) {
    const executable = options.executable ?? 'codex';
    if (executable.length === 0 || executable.includes('\u0000')) {
      throw new CodexCommandRunnerError(
        'unknown',
        'executable must be a non-empty path without NUL characters.',
      );
    }

    validateTimeout(options.timeoutMs);
    this.executable = executable;
    this.cwd = options.cwd;
    this.env = options.env;
    this.timeoutMs = options.timeoutMs ?? 300_000;
  }

  execute(
    args: readonly string[],
    options: CodexRunnerExecutionOptions = {},
  ): Promise<CodexRunnerExecutionResult> {
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    validateTimeout(timeoutMs);
    this.assertArgs(args);

    if (options.signal?.aborted) {
      return Promise.reject(
        new CodexCommandRunnerError('aborted', 'Codex execution was aborted before spawn.'),
      );
    }

    const { executable, args: spawnArgs } = this.getSpawnSpec(args);
    const child = this.spawnChild(executable, spawnArgs, options);

    return new Promise<CodexRunnerExecutionResult>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timer);
        if (options.signal !== undefined) {
          options.signal.removeEventListener('abort', onAbort);
        }
      };

      const fail = (error: CodexCommandRunnerError): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      const onAbort = (): void => {
        child.kill();
        fail(new CodexCommandRunnerError('aborted', 'Codex execution was aborted.'));
      };

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string | Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: string | Buffer) => {
        stderr += chunk.toString();
      });
      child.once('error', (error: NodeJS.ErrnoException) => {
        const kind =
          error.code === 'ENOENT' || error.code === 'EACCES' ? 'cli_unavailable' : 'unknown';
        fail(new CodexCommandRunnerError(kind, error.message, error.code));
      });
      child.once('close', (exitCode: number | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve({
          stdout,
          stderr,
          exitCode: exitCode ?? -1,
          durationMs: Date.now() - startedAt,
        });
      });

      if (options.signal !== undefined) {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      const timer = setTimeout(() => {
        child.kill();
        fail(new CodexCommandRunnerError('timeout', `Codex execution exceeded ${timeoutMs}ms.`));
      }, timeoutMs);

      this.writeStdin(child, options.stdin);
    });
  }

  async *stream(
    args: readonly string[],
    options: CodexRunnerExecutionOptions = {},
  ): AsyncIterable<CodexRunnerStreamEvent> {
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    validateTimeout(timeoutMs);
    this.assertArgs(args);

    if (options.signal?.aborted) {
      throw new CodexCommandRunnerError('aborted', 'Codex execution was aborted before spawn.');
    }

    const { executable, args: spawnArgs } = this.getSpawnSpec(args);
    const child = this.spawnChild(executable, spawnArgs, options);
    const queue: CodexRunnerStreamEvent[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    let failure: CodexCommandRunnerError | undefined;

    const notify = (): void => {
      wake?.();
      wake = undefined;
    };
    const enqueue = (event: CodexRunnerStreamEvent): void => {
      queue.push(event);
      notify();
    };
    const finish = (): void => {
      finished = true;
      notify();
    };
    const onAbort = (): void => {
      failure = new CodexCommandRunnerError('aborted', 'Codex execution was aborted.');
      child.kill();
      finish();
    };
    const onError = (error: NodeJS.ErrnoException): void => {
      const kind =
        error.code === 'ENOENT' || error.code === 'EACCES' ? 'cli_unavailable' : 'unknown';
      failure = new CodexCommandRunnerError(kind, error.message, error.code);
      finish();
    };
    const onClose = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (failure === undefined) {
        enqueue({
          type: 'close',
          exitCode,
          signal,
          durationMs: Date.now() - startedAt,
        });
      }
      finish();
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    const onStdout = (chunk: string | Buffer): void =>
      enqueue({ type: 'stdout', chunk: chunk.toString() });
    const onStderr = (chunk: string | Buffer): void =>
      enqueue({ type: 'stderr', chunk: chunk.toString() });
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.once('error', onError);
    child.once('close', onClose);
    if (options.signal !== undefined) {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => {
      failure = new CodexCommandRunnerError('timeout', `Codex execution exceeded ${timeoutMs}ms.`);
      child.kill();
      finish();
    }, timeoutMs);
    this.writeStdin(child, options.stdin);

    try {
      while (true) {
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }

        if (finished) {
          if (failure !== undefined) {
            throw failure;
          }
          return;
        }

        await new Promise<void>((resolve) => {
          wake = resolve;
          if (queue.length > 0 || finished) {
            wake = undefined;
            resolve();
          }
        });
      }
    } finally {
      clearTimeout(timer);
      if (options.signal !== undefined) {
        options.signal.removeEventListener('abort', onAbort);
      }
      child.stdout?.removeListener('data', onStdout);
      child.stderr?.removeListener('data', onStderr);
      child.removeListener('error', onError);
      child.removeListener('close', onClose);
      if (!finished) {
        child.kill();
      }
    }
  }

  private spawnChild(
    executable: string,
    args: readonly string[],
    options: CodexRunnerExecutionOptions,
  ): ChildProcess {
    return spawn(executable, [...args], {
      cwd: options.cwd ?? this.cwd,
      env: { ...process.env, ...this.env, ...options.env },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  private writeStdin(child: ChildProcess, stdin: string | undefined): void {
    if (child.stdin === null) {
      return;
    }

    child.stdin.end(stdin);
  }

  private assertArgs(args: readonly string[]): void {
    for (const arg of args) {
      if (typeof arg !== 'string' || arg.includes('\u0000')) {
        throw new CodexCommandRunnerError(
          'unknown',
          'Arguments must be strings without NUL characters.',
        );
      }
    }
  }

  private getSpawnSpec(args: readonly string[]): {
    readonly executable: string;
    readonly args: readonly string[];
  } {
    if (process.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(this.executable)) {
      return { executable: this.executable, args };
    }

    const commandLine = [this.executable, ...args].map(quoteWindowsCommandLineArgument).join(' ');
    return {
      executable: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', commandLine],
    };
  }
}

function quoteWindowsCommandLineArgument(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}
