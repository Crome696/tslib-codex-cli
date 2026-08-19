import { CodexValidationError } from './errors.js';
import type {
  CodexCommandInput,
  CodexReadOnlyInput,
  CodexResumeInput,
  CodexReviewInput,
  CodexRunInput,
} from './types.js';

const CREDENTIAL_FLAG =
  /(?:api[-_]?key|access[-_]?token|auth(?:entication)?[-_]?token|bearer(?:[-_]?token)?|password|secret|refresh[-_]?token|credential)/i;
const READ_ONLY_CONFIG = /(?:sandbox|approval|danger|workspace[-_]?write|full[-_]?access)/i;

export function validateCommandInput(
  operation: 'run' | 'resume' | 'review',
  input: CodexCommandInput,
): void {
  if (operation === 'run') {
    validateRunInput(input as CodexRunInput);
    return;
  }

  if (operation === 'resume') {
    validateResumeInput(input as CodexResumeInput);
    return;
  }

  validateReviewInput(input as CodexReviewInput);
}

export function validateRunInput(input: CodexRunInput): void {
  validateBaseInput(input);
  requireNonEmpty(input.prompt, 'prompt');
  assertOptionalString(input.stdin, 'stdin', false);
  assertOptionalString(input.localProvider, 'localProvider');
  assertOptionalString(input.profile, 'profile');
  assertOptionalString(input.cwd, 'cwd');
  assertOptionalString(input.outputSchema, 'outputSchema');
  assertOptionalString(input.outputLastMessage, 'outputLastMessage');
  assertOptionalStringArray(input.images, 'images');
  assertOptionalStringArray(input.addDirs, 'addDirs');
  assertOptionalBoolean(input.oss, 'oss');
  assertOptionalBoolean(input.approveForMe, 'approveForMe');
  assertOptionalBoolean(
    input.dangerouslyBypassApprovalsAndSandbox,
    'dangerouslyBypassApprovalsAndSandbox',
  );
  assertOptionalBoolean(input.dangerouslyBypassHookTrust, 'dangerouslyBypassHookTrust');
  assertOptionalBoolean(input.strictConfig, 'strictConfig');
  assertOptionalBoolean(input.skipGitRepoCheck, 'skipGitRepoCheck');
  assertOptionalBoolean(input.ephemeral, 'ephemeral');
  assertOptionalBoolean(input.ignoreUserConfig, 'ignoreUserConfig');
  assertOptionalBoolean(input.ignoreRules, 'ignoreRules');

  if (input.localProvider !== undefined && input.oss !== true) {
    throw validation('localProvider requires oss=true.');
  }

  if (input.approveForMe === true && input.dangerouslyBypassApprovalsAndSandbox === true) {
    throw validation(
      'approveForMe and dangerouslyBypassApprovalsAndSandbox are mutually exclusive.',
    );
  }

  if (
    input.sandbox !== undefined &&
    !['read-only', 'workspace-write', 'danger-full-access'].includes(input.sandbox)
  ) {
    throw validation(`Invalid sandbox value: ${String(input.sandbox)}.`);
  }

  if (input.color !== undefined && !['always', 'never', 'auto'].includes(input.color)) {
    throw validation(`Invalid color value: ${String(input.color)}.`);
  }
}

export function validateResumeInput(input: CodexResumeInput): void {
  validateBaseInput(input);
  rejectUnsupported(input, [
    'oss',
    'localProvider',
    'profile',
    'sandbox',
    'approveForMe',
    'cwd',
    'addDirs',
    'color',
  ]);

  assertOptionalString(input.sessionId, 'sessionId');
  assertOptionalBoolean(input.last, 'last');
  assertOptionalBoolean(input.all, 'all');
  assertOptionalString(input.prompt, 'prompt', false);
  assertOptionalString(input.stdin, 'stdin', false);
  assertOptionalStringArray(input.images, 'images');

  if (input.sessionId !== undefined && input.last === true) {
    throw validation('sessionId and last cannot be used together.');
  }

  if (input.sessionId === undefined && input.last !== true) {
    throw validation('Either sessionId or last=true is required for resume.');
  }
}

export function validateReviewInput(input: CodexReviewInput): void {
  validateBaseInput(input);
  rejectUnsupported(input, [
    'images',
    'oss',
    'localProvider',
    'profile',
    'sandbox',
    'approveForMe',
    'cwd',
    'addDirs',
    'color',
  ]);

  assertOptionalBoolean(input.uncommitted, 'uncommitted');
  assertOptionalString(input.base, 'base');
  assertOptionalString(input.commit, 'commit');
  assertOptionalString(input.title, 'title');
  assertOptionalString(input.prompt, 'prompt', false);
  assertOptionalString(input.stdin, 'stdin', false);

  const targetCount =
    Number(input.uncommitted === true) +
    Number(input.base !== undefined) +
    Number(input.commit !== undefined);
  if (targetCount > 1) {
    throw validation('uncommitted, base, and commit are mutually exclusive review targets.');
  }
}

export function validateReadOnlyInput(input: CodexReadOnlyInput): void {
  validateRunInput(input as CodexRunInput);

  if (input.sandbox !== undefined && input.sandbox !== 'read-only') {
    throw validation('plan and ask only support the read-only sandbox.');
  }

  if (input.addDirs !== undefined && input.addDirs.length > 0) {
    throw validation('plan and ask do not accept addDirs because it expands writable scope.');
  }

  if (
    input.approveForMe !== undefined ||
    input.dangerouslyBypassApprovalsAndSandbox !== undefined ||
    input.dangerouslyBypassHookTrust !== undefined
  ) {
    throw validation('plan and ask do not accept approval or bypass flags.');
  }

  for (const value of input.config ?? []) {
    const key = value.split('=', 1)[0] ?? value;
    if (READ_ONLY_CONFIG.test(key)) {
      throw validation(`plan and ask reject write-enabling config override: ${key}.`);
    }
  }

  rejectWriteEnablingExtraArgs(input.extraArgs ?? []);
}

export function validateTimeout(timeoutMs: unknown): void {
  if (timeoutMs === undefined) {
    return;
  }

  if (typeof timeoutMs !== 'number' || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw validation('timeoutMs must be a positive safe integer.');
  }
}

export function rejectCredentialArguments(args: readonly string[]): void {
  for (const [index, arg] of args.entries()) {
    if (arg.includes('\u0000')) {
      throw validation('Arguments must not contain NUL characters.');
    }

    const flag = arg.replace(/^--?/, '').split('=', 1)[0] ?? arg;
    if (CREDENTIAL_FLAG.test(flag)) {
      throw validation(`Credential-bearing argument rejected: ${flag}.`);
    }

    if (index > 0 && CREDENTIAL_FLAG.test(args[index - 1] ?? '')) {
      throw validation('Credential-bearing argument value rejected.');
    }
  }
}

export function rejectWriteEnablingExtraArgs(args: readonly string[]): void {
  for (const [index, arg] of args.entries()) {
    const normalized = arg.toLowerCase();
    if (
      /^--(?:approve-for-me|full-auto|yolo|dangerously-bypass-approvals-and-sandbox)(?:=|$)/.test(
        normalized,
      )
    ) {
      throw validation(`Write-enabling argument is not allowed here: ${arg}.`);
    }

    if (normalized === '--add-dir' || normalized.startsWith('--add-dir=')) {
      throw validation(`Write-enabling argument is not allowed here: ${arg}.`);
    }

    if (normalized === '--sandbox' || normalized.startsWith('--sandbox=')) {
      const value = normalized.includes('=')
        ? normalized.split('=', 2)[1]
        : args[index + 1]?.toLowerCase();
      if (value !== undefined && value !== 'read-only') {
        throw validation(`Non-read-only sandbox argument is not allowed here: ${arg}.`);
      }
    }
  }
}

function validateBaseInput(input: object): void {
  const candidate = input as Record<string, unknown>;
  assertOptionalStringArray(candidate.config as readonly string[] | undefined, 'config');
  assertOptionalStringArray(candidate.enable as readonly string[] | undefined, 'enable');
  assertOptionalStringArray(candidate.disable as readonly string[] | undefined, 'disable');
  assertOptionalString(candidate.model as string | undefined, 'model');
  assertOptionalString(candidate.outputSchema as string | undefined, 'outputSchema');
  assertOptionalString(candidate.outputLastMessage as string | undefined, 'outputLastMessage');
  assertOptionalStringArray(candidate.extraArgs as readonly string[] | undefined, 'extraArgs');
  assertOptionalBoolean(candidate.strictConfig as boolean | undefined, 'strictConfig');
  assertOptionalBoolean(
    candidate.dangerouslyBypassApprovalsAndSandbox as boolean | undefined,
    'dangerouslyBypassApprovalsAndSandbox',
  );
  assertOptionalBoolean(
    candidate.dangerouslyBypassHookTrust as boolean | undefined,
    'dangerouslyBypassHookTrust',
  );
  assertOptionalBoolean(candidate.skipGitRepoCheck as boolean | undefined, 'skipGitRepoCheck');
  assertOptionalBoolean(candidate.ephemeral as boolean | undefined, 'ephemeral');
  assertOptionalBoolean(candidate.ignoreUserConfig as boolean | undefined, 'ignoreUserConfig');
  assertOptionalBoolean(candidate.ignoreRules as boolean | undefined, 'ignoreRules');

  if (
    candidate.outputFormat !== undefined &&
    candidate.outputFormat !== 'text' &&
    candidate.outputFormat !== 'jsonl'
  ) {
    throw validation(`Invalid outputFormat value: ${String(candidate.outputFormat)}.`);
  }

  validateTimeout(candidate.timeoutMs);
  rejectCredentialArguments((candidate.extraArgs as readonly string[] | undefined) ?? []);

  for (const value of (candidate.config as readonly string[] | undefined) ?? []) {
    requireNonEmpty(value, 'config entry');
    if (CREDENTIAL_FLAG.test(value.split('=', 1)[0] ?? value)) {
      throw validation('Credential-bearing config overrides are rejected.');
    }
  }
}

function rejectUnsupported(input: object, keys: readonly string[]): void {
  const candidate = input as Record<string, unknown>;
  for (const key of keys) {
    if (candidate[key] !== undefined) {
      throw validation(`${key} is not supported by this Codex subcommand.`);
    }
  }
}

function requireNonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw validation(`${name} must be a non-empty string.`);
  }

  if (value.includes('\u0000')) {
    throw validation(`${name} must not contain NUL characters.`);
  }
}

function assertOptionalString(value: unknown, name: string, allowEmpty = false): void {
  if (value === undefined) {
    return;
  }

  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw validation(`${name} must be a non-empty string.`);
  }

  if (value.includes('\u0000')) {
    throw validation(`${name} must not contain NUL characters.`);
  }
}

function assertOptionalStringArray(value: unknown, name: string): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    throw validation(`${name} must be an array of non-empty strings.`);
  }

  for (const entry of value) {
    requireNonEmpty(entry, `${name} entry`);
  }
}

function assertOptionalBoolean(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw validation(`${name} must be a boolean.`);
  }
}

function validation(message: string): CodexValidationError {
  return new CodexValidationError(message);
}
