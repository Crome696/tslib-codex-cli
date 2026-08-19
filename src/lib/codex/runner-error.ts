export type CodexRunnerErrorKind = 'cli_unavailable' | 'timeout' | 'aborted' | 'unknown';

export class CodexCommandRunnerError extends Error {
  readonly name = 'CodexCommandRunnerError';

  constructor(
    readonly kind: CodexRunnerErrorKind,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
