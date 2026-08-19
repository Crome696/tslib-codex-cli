import { CodexCommandRunner } from './command-runner.js';
import {
  CodexCliError,
  CodexCliExitError,
  CodexConfigurationError,
  CodexParseError,
  makeFailure,
  makeSuccess,
  sanitizeDiagnostic,
  toCodexErrorData,
} from './errors.js';
import { buildCodexCliArgs } from './args.js';
import { parseCodexEvent, parseCodexOutput, parseCodexVersion } from './parsers.js';
import { validateReadOnlyInput, validateTimeout } from './validation.js';
import type {
  CodexCliClientOptions,
  CodexCommandInput,
  CodexCommandRunnerLike,
  CodexEvent,
  CodexHealth,
  CodexParsedOutput,
  CodexPlanInput,
  CodexAskInput,
  CodexResumeInput,
  CodexReviewInput,
  CodexResult,
  CodexRunnerExecutionOptions,
  CodexRunInput,
  CodexStreamInput,
} from './types.js';

const PLAN_PREFIX =
  'Work in read-only planning mode. Do not modify files or execute write actions.\n\n';
const ASK_PREFIX =
  'Answer this request in read-only mode. Do not modify files or execute write actions.\n\n';

export class CodexCliClient {
  readonly executable: string;

  private readonly runner: CodexCommandRunnerLike;
  private readonly defaultCwd: string | undefined;
  private readonly defaultEnv: NodeJS.ProcessEnv | undefined;
  private readonly timeoutMs: number;

  constructor(options: CodexCliClientOptions = {}) {
    const executable = options.executable ?? 'codex';
    if (executable.length === 0 || executable.includes('\u0000')) {
      throw new CodexConfigurationError(
        'executable must be a non-empty path without NUL characters.',
      );
    }
    if (options.cwd !== undefined && (options.cwd.length === 0 || options.cwd.includes('\u0000'))) {
      throw new CodexConfigurationError('cwd must be a non-empty path without NUL characters.');
    }
    validateTimeout(options.timeoutMs);

    this.executable = executable;
    this.defaultCwd = options.cwd;
    this.defaultEnv = options.env;
    this.timeoutMs = options.timeoutMs ?? 300_000;

    if (options.runner !== undefined) {
      this.runner = options.runner;
    } else {
      const runnerOptions = {
        ...(options.executable === undefined ? {} : { executable: options.executable }),
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      };
      this.runner = new CodexCommandRunner(runnerOptions);
    }
  }

  run(input: CodexRunInput): Promise<CodexResult<CodexParsedOutput>> {
    return this.executeAggregate({ ...input, operation: 'run' });
  }

  plan(input: CodexPlanInput): Promise<CodexResult<CodexParsedOutput>> {
    const readOnlyInput: CodexRunInput = {
      ...input,
      prompt: `${PLAN_PREFIX}${input.prompt}`,
      sandbox: input.sandbox ?? 'read-only',
    };
    try {
      validateReadOnlyInput(readOnlyInput as CodexPlanInput);
    } catch (error) {
      return Promise.resolve(makeFailure(error));
    }
    return this.executeAggregate({ ...readOnlyInput, operation: 'run' });
  }

  ask(input: CodexAskInput): Promise<CodexResult<CodexParsedOutput>> {
    const readOnlyInput: CodexRunInput = {
      ...input,
      prompt: `${ASK_PREFIX}${input.prompt}`,
      sandbox: input.sandbox ?? 'read-only',
    };
    try {
      validateReadOnlyInput(readOnlyInput as CodexAskInput);
    } catch (error) {
      return Promise.resolve(makeFailure(error));
    }
    return this.executeAggregate({ ...readOnlyInput, operation: 'run' });
  }

  resume(input: CodexResumeInput): Promise<CodexResult<CodexParsedOutput>> {
    return this.executeAggregate({ ...input, operation: 'resume' });
  }

  review(input: CodexReviewInput): Promise<CodexResult<CodexParsedOutput>> {
    return this.executeAggregate({ ...input, operation: 'review' });
  }

  async *stream(input: CodexStreamInput): AsyncGenerator<CodexEvent, void, unknown> {
    const commandInput: CodexRunInput = { ...input, outputFormat: 'jsonl' };
    const args = buildCodexCliArgs({ ...commandInput, operation: 'run' });
    if (this.runner.stream === undefined) {
      throw new CodexCliError({
        category: 'configuration',
        message: 'The injected command runner does not implement streaming.',
      });
    }

    const source = this.runner.stream(args, this.runnerOptions(input));
    const iterator = source[Symbol.asyncIterator]();
    let lineBuffer = '';
    let stderr = '';
    let sawEvent = false;
    let closeExitCode: number | null = null;

    try {
      while (true) {
        const next = await iterator.next();
        if (next.done) {
          break;
        }

        if (next.value.type === 'stdout') {
          lineBuffer += next.value.chunk;
          for (const line of takeCompleteLines(
            () => lineBuffer,
            (value) => (lineBuffer = value),
          )) {
            if (line.trim().length === 0) {
              continue;
            }
            sawEvent = true;
            yield parseJsonlEvent(line, stderr);
          }
          continue;
        }

        if (next.value.type === 'stderr') {
          stderr += next.value.chunk;
          continue;
        }

        closeExitCode = next.value.exitCode;
        if (lineBuffer.trim().length > 0) {
          sawEvent = true;
          yield parseJsonlEvent(lineBuffer, stderr);
          lineBuffer = '';
        }
        if (closeExitCode !== null && closeExitCode !== 0) {
          throw new CodexCliError(
            toCodexErrorData(new CodexCliExitError(closeExitCode, '', stderr)),
            '',
            stderr,
          );
        }
      }

      if (lineBuffer.trim().length > 0) {
        sawEvent = true;
        yield parseJsonlEvent(lineBuffer, stderr);
      }
      if (!sawEvent) {
        throw new CodexCliError(
          {
            category: 'parse',
            message: 'Codex JSONL stream produced no events.',
            diagnostic: sanitizeDiagnostic(stderr),
          },
          '',
          stderr,
        );
      }
    } catch (error) {
      if (error instanceof CodexCliError) {
        throw error;
      }
      const data = toCodexErrorData(error, 'unknown');
      throw new CodexCliError(data, '', stderr);
    } finally {
      await iterator.return?.();
    }
  }

  async health(): Promise<CodexResult<CodexHealth>> {
    let versionOutput;
    try {
      versionOutput = await this.runner.execute(['--version'], this.runnerOptions());
    } catch (error) {
      return makeFailure(error);
    }

    if (versionOutput.exitCode !== 0) {
      return makeFailure(
        new CodexCliExitError(versionOutput.exitCode, versionOutput.stdout, versionOutput.stderr),
        versionOutput,
      );
    }

    const version = parseCodexVersion(versionOutput.stdout || versionOutput.stderr);
    if (version === null) {
      return makeFailure(
        new CodexParseError('Codex --version did not contain a recognizable semantic version.'),
        versionOutput,
      );
    }

    let doctorOutput:
      | {
          readonly stdout: string;
          readonly stderr: string;
          readonly exitCode: number;
          readonly durationMs: number;
        }
      | undefined;
    let doctorError: string | null = null;
    try {
      doctorOutput = await this.runner.execute(
        ['doctor', '--json', '--summary'],
        this.runnerOptions(),
      );
    } catch (error) {
      doctorError = sanitizeDiagnostic(toCodexErrorData(error).message);
    }

    const doctorText = doctorOutput?.stdout.trim() ?? '';
    const doctor = parseOptionalJson(doctorText);
    const diagnostic = sanitizeDiagnostic(
      [
        doctorOutput?.stderr ?? '',
        doctorError ?? '',
        doctor === null && doctorText.length > 0 ? doctorText : '',
      ]
        .filter((value) => value.length > 0)
        .join('\n'),
    );
    const authenticated = detectAuthentication(doctor, diagnostic);
    const result: CodexHealth = {
      executable: this.executable,
      available: true,
      version,
      authenticated,
      doctor: redactSensitiveValue(doctor),
      doctorExitCode: doctorOutput?.exitCode ?? null,
      diagnostic: diagnostic.length > 0 ? diagnostic : null,
    };

    return makeSuccess(result, {
      stdout: versionOutput.stdout,
      stderr: [versionOutput.stderr, doctorOutput?.stderr ?? '', doctorError ?? '']
        .filter(Boolean)
        .join('\n'),
      exitCode: versionOutput.exitCode,
      durationMs: versionOutput.durationMs + (doctorOutput?.durationMs ?? 0),
    });
  }

  private async executeAggregate(
    input: CodexCommandInput,
  ): Promise<CodexResult<CodexParsedOutput>> {
    let args: readonly string[];
    try {
      args = buildCodexCliArgs(input);
    } catch (error) {
      return makeFailure(error);
    }

    let output;
    try {
      output = await this.runner.execute(args, this.runnerOptions(input));
    } catch (error) {
      return makeFailure(error);
    }

    if (output.exitCode !== 0) {
      return makeFailure(
        new CodexCliExitError(output.exitCode, output.stdout, output.stderr),
        output,
      );
    }

    try {
      const format = input.outputFormat ?? 'jsonl';
      return makeSuccess(parseCodexOutput(output.stdout, format), output);
    } catch (error) {
      return makeFailure(error, output);
    }
  }

  private runnerOptions(input?: {
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    readonly stdin?: string;
    readonly env?: NodeJS.ProcessEnv;
  }): CodexRunnerExecutionOptions {
    const options: CodexRunnerExecutionOptions = {
      timeoutMs: input?.timeoutMs ?? this.timeoutMs,
    };
    const environment = mergeEnvironment(this.defaultEnv, input?.env);
    if (this.defaultCwd !== undefined) {
      Object.assign(options, { cwd: this.defaultCwd });
    }
    if (environment !== undefined) {
      Object.assign(options, { env: environment });
    }
    if (input?.signal !== undefined) {
      Object.assign(options, { signal: input.signal });
    }
    if (input?.stdin !== undefined) {
      Object.assign(options, { stdin: input.stdin });
    }
    return options;
  }
}

function parseJsonlEvent(line: string, stderr: string): CodexEvent {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid JSON';
    throw new CodexCliError(
      {
        category: 'parse',
        message: `Invalid Codex JSONL stream: ${message}`,
        diagnostic: sanitizeDiagnostic(stderr),
      },
      line,
      stderr,
    );
  }

  try {
    return parseCodexEvent(value);
  } catch (error) {
    throw new CodexCliError(toCodexErrorData(error, 'parse'), line, stderr);
  }
}

function takeCompleteLines(
  getBuffer: () => string,
  setBuffer: (value: string) => void,
): readonly string[] {
  const lines: string[] = [];
  let buffer = getBuffer();
  let newlineIndex = buffer.indexOf('\n');
  while (newlineIndex >= 0) {
    lines.push(buffer.slice(0, newlineIndex).replace(/\r$/, ''));
    buffer = buffer.slice(newlineIndex + 1);
    newlineIndex = buffer.indexOf('\n');
  }
  setBuffer(buffer);
  return lines;
}

function mergeEnvironment(
  base: NodeJS.ProcessEnv | undefined,
  overlay: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv | undefined {
  if (base === undefined && overlay === undefined) {
    return undefined;
  }
  return { ...base, ...overlay };
}

function parseOptionalJson(value: string): unknown {
  if (value.length === 0) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function detectAuthentication(doctor: unknown, diagnostic: string): CodexHealth['authenticated'] {
  if (isRecord(doctor)) {
    for (const key of ['authenticated', 'is_authenticated', 'logged_in', 'is_logged_in']) {
      if (doctor[key] === true) {
        return 'authenticated';
      }
      if (doctor[key] === false) {
        return 'unauthenticated';
      }
    }
    for (const key of ['auth_status', 'authentication', 'status']) {
      if (typeof doctor[key] === 'string') {
        const value = doctor[key].toLowerCase();
        if (/unauth|not.?logged|login.?required/.test(value)) {
          return 'unauthenticated';
        }
        if (/auth|logged.?in|ready/.test(value)) {
          return 'authenticated';
        }
      }
    }
  }

  if (/unauth|not\s+logged|login\s+required|api\s+key/i.test(diagnostic)) {
    return 'unauthenticated';
  }
  if (/authenticated|logged\s+in/i.test(diagnostic)) {
    return 'authenticated';
  }
  return 'unknown';
}

function redactSensitiveValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeDiagnostic(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactSensitiveValue);
  }
  if (!isRecord(value)) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] =
      /api[-_ ]?key|access[-_ ]?token|auth(?:entication)?[-_ ]?token|bearer|password|secret|credential/i.test(
        key,
      )
        ? '[REDACTED]'
        : redactSensitiveValue(entry);
  }
  return redacted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
