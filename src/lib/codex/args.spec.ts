import { describe, expect, it } from 'vitest';
import { buildCodexCliArgs } from './args.js';

describe('buildCodexCliArgs', () => {
  it('builds direct JSONL execution arguments in deterministic order', () => {
    const input = {
      prompt: 'Implement the feature',
      config: ['model_reasoning_effort="high"'],
      enable: ['feature_a'],
      strictConfig: true,
      disable: ['feature_b'],
      images: ['one.png', 'two.png'],
      model: 'gpt-5-codex',
      oss: true,
      localProvider: 'ollama',
      profile: 'automation',
      sandbox: 'workspace-write' as const,
      dangerouslyBypassHookTrust: true,
      cwd: 'repo',
      addDirs: ['shared'],
      skipGitRepoCheck: true,
      ephemeral: true,
      ignoreUserConfig: true,
      ignoreRules: true,
      outputSchema: 'schema.json',
      color: 'never' as const,
      outputLastMessage: 'last.md',
      extraArgs: ['--future-flag', 'value'],
    };

    const first = buildCodexCliArgs(input);
    const second = buildCodexCliArgs(input);

    expect(first).toEqual(second);
    expect(first).toEqual([
      'exec',
      '--config',
      'model_reasoning_effort="high"',
      '--enable',
      'feature_a',
      '--strict-config',
      '--disable',
      'feature_b',
      '--image',
      'one.png',
      '--image',
      'two.png',
      '--model',
      'gpt-5-codex',
      '--oss',
      '--local-provider',
      'ollama',
      '--profile',
      'automation',
      '--sandbox',
      'workspace-write',
      '--dangerously-bypass-hook-trust',
      '--cd',
      'repo',
      '--add-dir',
      'shared',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--output-schema',
      'schema.json',
      '--color',
      'never',
      '--json',
      '--output-last-message',
      'last.md',
      '--future-flag',
      'value',
      'Implement the feature',
    ]);
  });

  it('supports explicit text output and stdin prompts', () => {
    expect(buildCodexCliArgs({ prompt: '-', outputFormat: 'text', stdin: 'from stdin' })).toEqual([
      'exec',
      '-',
    ]);
  });

  it('builds resume and review subcommands with their supported flags', () => {
    expect(
      buildCodexCliArgs({
        operation: 'resume',
        sessionId: 'session-1',
        all: true,
        model: 'gpt-5-codex',
        images: ['context.png'],
        ephemeral: true,
        outputFormat: 'jsonl',
        extraArgs: ['--future-resume'],
        prompt: 'Continue',
      }),
    ).toEqual([
      'exec',
      'resume',
      '--image',
      'context.png',
      '--model',
      'gpt-5-codex',
      '--ephemeral',
      '--json',
      '--all',
      '--future-resume',
      'session-1',
      'Continue',
    ]);

    expect(
      buildCodexCliArgs({
        operation: 'review',
        base: 'master',
        title: 'Review title',
        outputFormat: 'text',
        prompt: 'Focus on regressions',
      }),
    ).toEqual([
      'exec',
      'review',
      '--title',
      'Review title',
      '--base',
      'master',
      'Focus on regressions',
    ]);
  });

  it('rejects empty values, NUL characters, invalid timeouts, conflicts, and credentials', () => {
    expect(() => buildCodexCliArgs({ prompt: '' })).toThrow(/prompt/i);
    expect(() => buildCodexCliArgs({ prompt: 'bad\u0000prompt' })).toThrow(/NUL/i);
    expect(() => buildCodexCliArgs({ prompt: 'prompt', timeoutMs: 0 })).toThrow(/timeout/i);
    expect(() =>
      buildCodexCliArgs({
        prompt: 'prompt',
        approveForMe: true,
        dangerouslyBypassApprovalsAndSandbox: true,
      }),
    ).toThrow(/mutually exclusive/i);
    expect(() => buildCodexCliArgs({ prompt: 'prompt', extraArgs: ['--api-key=secret'] })).toThrow(
      /credential/i,
    );
    expect(() => buildCodexCliArgs({ prompt: 'prompt', extraArgs: ['--token', 'secret'] })).toThrow(
      /credential/i,
    );
    expect(() => buildCodexCliArgs({ operation: 'resume', sessionId: 'id', last: true })).toThrow(
      /sessionId/i,
    );
    expect(() => buildCodexCliArgs({ operation: 'review', base: 'master', commit: 'abc' })).toThrow(
      /mutually exclusive/i,
    );
  });
});
