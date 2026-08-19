import type { CodexErrorCategory, CodexErrorData, CodexFailure, CodexSuccess } from './types.js';
import { CodexCommandRunnerError } from './runner-error.js';

const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-?]*[ -/]*[@-~]`, 'g');
const CREDENTIAL_ASSIGNMENT =
  /((?:api[-_ ]?key|access[-_ ]?token|auth(?:entication)?[-_ ]?token|bearer|password|secret|refresh[-_ ]?token)\s*[:=]\s*)[^\s,;]+/gi;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+\-/]+=*/gi;
const TOKEN_VALUE = /\b(?:sk|rk|ghp|github_pat|xox[baprs])-[-_A-Za-z0-9]+\b/g;
const DIAGNOSTIC_LIMIT = 2_000;

export class CodexValidationError extends Error {
  readonly name = 'CodexValidationError';
  readonly category = 'validation' as const;
}

export class CodexParseError extends Error {
  readonly name = 'CodexParseError';
  readonly category = 'parse' as const;
}

export class CodexConfigurationError extends Error {
  readonly name = 'CodexConfigurationError';
  readonly category = 'configuration' as const;
}

export class CodexCliExitError extends Error {
  readonly name = 'CodexCliExitError';
  readonly category: CodexErrorCategory;

  constructor(
    readonly exitCode: number,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(`Codex CLI exited with code ${exitCode}.`);
    this.category = classifyCliExit(stderr, stdout, exitCode);
  }
}

export class CodexCliError extends Error {
  readonly name = 'CodexCliError';

  constructor(
    readonly error: CodexErrorData,
    readonly stdout = '',
    readonly stderr = '',
  ) {
    super(error.message);
  }
}

export function sanitizeDiagnostic(value: string): string {
  const sanitized = value
    .replace(ANSI_ESCAPE, '')
    .replace(CREDENTIAL_ASSIGNMENT, '$1[REDACTED]')
    .replace(BEARER_VALUE, 'Bearer [REDACTED]')
    .replace(TOKEN_VALUE, '[REDACTED]');

  if (sanitized.length <= DIAGNOSTIC_LIMIT) {
    return sanitized;
  }

  return `${sanitized.slice(0, DIAGNOSTIC_LIMIT - 3)}...`;
}

export function classifyCliExit(
  stderr: string,
  stdout: string,
  exitCode: number,
): CodexErrorCategory {
  const diagnostic = `${stderr}\n${stdout}`;

  if (/invalid\s+model|unknown\s+model|model.*not\s+found/i.test(diagnostic)) {
    return 'invalid_model';
  }

  if (
    /unauthori[sz]ed|authentication|not\s+logged\s+in|login\s+required|api\s*key|credential/i.test(
      diagnostic,
    )
  ) {
    return 'authentication';
  }

  if (/permission|approval|sandbox|access\s+denied/i.test(diagnostic)) {
    return 'permission';
  }

  return exitCode === 127 ? 'cli_unavailable' : 'cli_exit';
}

export function toCodexErrorData(
  error: unknown,
  fallback: CodexErrorCategory = 'unknown',
): CodexErrorData {
  if (error instanceof CodexValidationError) {
    return { category: 'validation', message: error.message };
  }

  if (error instanceof CodexParseError) {
    return { category: 'parse', message: error.message };
  }

  if (error instanceof CodexConfigurationError) {
    return { category: 'configuration', message: error.message };
  }

  if (error instanceof CodexCliExitError) {
    const diagnostic = sanitizeDiagnostic(error.stderr || error.stdout);
    const data: CodexErrorData = {
      category: error.category,
      message: error.message,
      exitCode: error.exitCode,
    };
    return diagnostic.length === 0 ? data : { ...data, diagnostic };
  }

  if (error instanceof CodexCliError) {
    return error.error;
  }

  if (error instanceof CodexCommandRunnerError) {
    const data: CodexErrorData = {
      category: error.kind,
      message: error.message,
    };
    return error.code === undefined ? data : { ...data, code: error.code };
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return { category: 'aborted', message: error.message || 'Codex execution was aborted.' };
  }

  if (isNodeError(error) && error.code === 'ENOENT') {
    return {
      category: 'cli_unavailable',
      message: 'The configured Codex executable was not found.',
      code: error.code,
    };
  }

  if (error instanceof Error) {
    return { category: fallback, message: error.message };
  }

  return { category: fallback, message: 'Codex execution failed for an unknown reason.' };
}

export function makeSuccess<T>(
  value: T,
  output: {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
    readonly durationMs: number;
  },
): CodexSuccess<T> {
  return {
    ok: true,
    value,
    stdout: output.stdout,
    stderr: sanitizeDiagnostic(output.stderr),
    exitCode: output.exitCode,
    durationMs: output.durationMs,
  };
}

export function makeFailure(
  error: unknown,
  output: {
    readonly stdout?: string;
    readonly stderr?: string;
    readonly exitCode?: number | null;
    readonly durationMs?: number;
  } = {},
  fallback: CodexErrorCategory = 'unknown',
): CodexFailure {
  const stdout = output.stdout ?? '';
  const stderr = sanitizeDiagnostic(output.stderr ?? '');
  const data = toCodexErrorData(error, fallback);
  const diagnosticSource = stderr || sanitizeDiagnostic(stdout);
  const errorData: CodexErrorData =
    diagnosticSource.length > 0 && data.diagnostic === undefined
      ? { ...data, diagnostic: sanitizeDiagnostic(diagnosticSource) }
      : data;

  return {
    ok: false,
    error: errorData,
    stdout,
    stderr,
    exitCode: output.exitCode ?? null,
    durationMs: output.durationMs ?? 0,
  };
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}
