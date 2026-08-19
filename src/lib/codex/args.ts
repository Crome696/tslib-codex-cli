import { validateCommandInput } from './validation.js';
import type {
  CodexCommandInput,
  CodexOutputFormat,
  CodexResumeInput,
  CodexReviewInput,
  CodexRunInput,
} from './types.js';

export function buildCodexCliArgs(input: CodexCommandInput): readonly string[] {
  const operation = input.operation ?? 'run';
  validateCommandInput(operation, input);

  if (operation === 'run') {
    return buildRunArgs(input as CodexRunInput);
  }
  if (operation === 'resume') {
    return buildResumeArgs(input as CodexResumeInput);
  }
  return buildReviewArgs(input as CodexReviewInput);
}

function buildRunArgs(input: CodexRunInput): readonly string[] {
  const args = ['exec'];
  appendConfigFlags(args, input);
  appendRepeated(args, '--image', input.images);
  appendValue(args, '--model', input.model);
  if (input.oss === true) {
    args.push('--oss');
  }
  appendValue(args, '--local-provider', input.localProvider);
  appendValue(args, '--profile', input.profile);
  appendValue(args, '--sandbox', input.sandbox);
  if (input.approveForMe === true) {
    args.push('--approve-for-me');
  }
  if (input.dangerouslyBypassApprovalsAndSandbox === true) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  }
  if (input.dangerouslyBypassHookTrust === true) {
    args.push('--dangerously-bypass-hook-trust');
  }
  appendValue(args, '--cd', input.cwd);
  appendRepeated(args, '--add-dir', input.addDirs);
  if (input.skipGitRepoCheck === true) {
    args.push('--skip-git-repo-check');
  }
  if (input.ephemeral === true) {
    args.push('--ephemeral');
  }
  if (input.ignoreUserConfig === true) {
    args.push('--ignore-user-config');
  }
  if (input.ignoreRules === true) {
    args.push('--ignore-rules');
  }
  appendValue(args, '--output-schema', input.outputSchema);
  appendValue(args, '--color', input.color);
  appendOutputFlags(args, input.outputFormat);
  appendValue(args, '--output-last-message', input.outputLastMessage);
  appendExtraArgs(args, input.extraArgs);
  appendPrompt(args, input.prompt);
  return args;
}

function buildResumeArgs(input: CodexResumeInput): readonly string[] {
  const args = ['exec', 'resume'];
  appendConfigFlags(args, input);
  appendRepeated(args, '--image', input.images);
  appendValue(args, '--model', input.model);
  if (input.dangerouslyBypassApprovalsAndSandbox === true) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  }
  if (input.dangerouslyBypassHookTrust === true) {
    args.push('--dangerously-bypass-hook-trust');
  }
  if (input.skipGitRepoCheck === true) {
    args.push('--skip-git-repo-check');
  }
  if (input.ephemeral === true) {
    args.push('--ephemeral');
  }
  if (input.ignoreUserConfig === true) {
    args.push('--ignore-user-config');
  }
  if (input.ignoreRules === true) {
    args.push('--ignore-rules');
  }
  appendValue(args, '--output-schema', input.outputSchema);
  appendOutputFlags(args, input.outputFormat);
  appendValue(args, '--output-last-message', input.outputLastMessage);
  if (input.last === true) {
    args.push('--last');
  }
  if (input.all === true) {
    args.push('--all');
  }
  appendExtraArgs(args, input.extraArgs);
  appendValue(args, undefined, input.sessionId);
  appendPrompt(args, input.prompt);
  return args;
}

function buildReviewArgs(input: CodexReviewInput): readonly string[] {
  const args = ['exec', 'review'];
  appendConfigFlags(args, input);
  appendValue(args, '--title', input.title);
  appendValue(args, '--model', input.model);
  if (input.dangerouslyBypassApprovalsAndSandbox === true) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  }
  if (input.dangerouslyBypassHookTrust === true) {
    args.push('--dangerously-bypass-hook-trust');
  }
  if (input.skipGitRepoCheck === true) {
    args.push('--skip-git-repo-check');
  }
  if (input.ephemeral === true) {
    args.push('--ephemeral');
  }
  if (input.ignoreUserConfig === true) {
    args.push('--ignore-user-config');
  }
  if (input.ignoreRules === true) {
    args.push('--ignore-rules');
  }
  appendValue(args, '--output-schema', input.outputSchema);
  appendOutputFlags(args, input.outputFormat);
  appendValue(args, '--output-last-message', input.outputLastMessage);
  if (input.uncommitted === true) {
    args.push('--uncommitted');
  }
  appendValue(args, '--base', input.base);
  appendValue(args, '--commit', input.commit);
  appendExtraArgs(args, input.extraArgs);
  appendPrompt(args, input.prompt);
  return args;
}

function appendConfigFlags(
  args: string[],
  input: {
    readonly config?: readonly string[];
    readonly enable?: readonly string[];
    readonly strictConfig?: boolean;
    readonly disable?: readonly string[];
  },
): void {
  appendRepeated(args, '--config', input.config);
  appendRepeated(args, '--enable', input.enable);
  if (input.strictConfig === true) {
    args.push('--strict-config');
  }
  appendRepeated(args, '--disable', input.disable);
}

function appendOutputFlags(args: string[], outputFormat: CodexOutputFormat | undefined): void {
  if ((outputFormat ?? 'jsonl') === 'jsonl') {
    args.push('--json');
  }
}

function appendExtraArgs(args: string[], extraArgs: readonly string[] | undefined): void {
  if (extraArgs !== undefined) {
    args.push(...extraArgs);
  }
}

function appendRepeated(args: string[], flag: string, values: readonly string[] | undefined): void {
  for (const value of values ?? []) {
    args.push(flag, value);
  }
}

function appendValue(args: string[], flag: string | undefined, value: string | undefined): void {
  if (value !== undefined) {
    if (flag !== undefined) {
      args.push(flag, value);
    } else {
      args.push(value);
    }
  }
}

function appendPrompt(args: string[], prompt: string | undefined): void {
  appendValue(args, undefined, prompt);
}
