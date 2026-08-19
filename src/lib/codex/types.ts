export type CodexOutputFormat = 'text' | 'jsonl';

export type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

export type CodexColor = 'always' | 'never' | 'auto';

export type CodexErrorCategory =
  | 'validation'
  | 'cli_unavailable'
  | 'authentication'
  | 'permission'
  | 'invalid_model'
  | 'timeout'
  | 'aborted'
  | 'cli_exit'
  | 'parse'
  | 'configuration'
  | 'unknown';

export interface CodexErrorData {
  readonly category: CodexErrorCategory;
  readonly message: string;
  readonly diagnostic?: string;
  readonly exitCode?: number | null;
  readonly code?: string;
}

export interface CodexSuccess<T> {
  readonly ok: true;
  readonly value: T;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
}

export interface CodexFailure {
  readonly ok: false;
  readonly error: CodexErrorData;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly durationMs: number;
}

export type CodexResult<T> = CodexSuccess<T> | CodexFailure;

export interface CodexBaseInput {
  readonly config?: readonly string[];
  readonly enable?: readonly string[];
  readonly strictConfig?: boolean;
  readonly disable?: readonly string[];
  readonly model?: string;
  readonly dangerouslyBypassApprovalsAndSandbox?: boolean;
  readonly dangerouslyBypassHookTrust?: boolean;
  readonly skipGitRepoCheck?: boolean;
  readonly ephemeral?: boolean;
  readonly ignoreUserConfig?: boolean;
  readonly ignoreRules?: boolean;
  readonly outputSchema?: string;
  readonly outputFormat?: CodexOutputFormat;
  readonly outputLastMessage?: string;
  readonly extraArgs?: readonly string[];
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly env?: NodeJS.ProcessEnv;
}

export interface CodexRunInput extends CodexBaseInput {
  readonly prompt: string;
  readonly stdin?: string;
  readonly images?: readonly string[];
  readonly oss?: boolean;
  readonly localProvider?: string;
  readonly profile?: string;
  readonly sandbox?: CodexSandbox;
  readonly approveForMe?: boolean;
  readonly cwd?: string;
  readonly addDirs?: readonly string[];
  readonly color?: CodexColor;
}

export interface CodexResumeInput extends CodexBaseInput {
  readonly sessionId?: string;
  readonly last?: boolean;
  readonly all?: boolean;
  readonly prompt?: string;
  readonly stdin?: string;
  readonly images?: readonly string[];
}

export interface CodexReviewInput extends CodexBaseInput {
  readonly uncommitted?: boolean;
  readonly base?: string;
  readonly commit?: string;
  readonly title?: string;
  readonly prompt?: string;
  readonly stdin?: string;
}

export type CodexPlanInput = Omit<
  CodexRunInput,
  'approveForMe' | 'dangerouslyBypassApprovalsAndSandbox' | 'dangerouslyBypassHookTrust' | 'sandbox'
> & {
  readonly sandbox?: 'read-only';
  readonly approveForMe?: never;
  readonly dangerouslyBypassApprovalsAndSandbox?: never;
  readonly dangerouslyBypassHookTrust?: never;
};

export type CodexAskInput = CodexPlanInput;

export type CodexReadOnlyInput = CodexPlanInput;

export type CodexStreamInput = Omit<CodexRunInput, 'outputFormat'> & {
  readonly outputFormat?: never;
};

export type CodexCommandInput =
  | (CodexRunInput & { readonly operation?: 'run' })
  | (CodexResumeInput & { readonly operation: 'resume' })
  | (CodexReviewInput & { readonly operation: 'review' });

export interface CodexCliClientOptions {
  readonly executable?: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly runner?: CodexCommandRunnerLike;
}

export interface CodexRunnerExecutionOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly stdin?: string;
}

export interface CodexRunnerExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
}

export type CodexRunnerStreamEvent =
  | {
      readonly type: 'stdout';
      readonly chunk: string;
    }
  | {
      readonly type: 'stderr';
      readonly chunk: string;
    }
  | {
      readonly type: 'close';
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly durationMs: number;
    };

export interface CodexCommandRunnerLike {
  execute(
    args: readonly string[],
    options?: CodexRunnerExecutionOptions,
  ): Promise<CodexRunnerExecutionResult>;
  stream?(
    args: readonly string[],
    options?: CodexRunnerExecutionOptions,
  ): AsyncIterable<CodexRunnerStreamEvent>;
}

export interface CodexUsage {
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly raw: unknown;
}

export interface CodexItemBase {
  readonly id: string | null;
  readonly type: string;
  readonly raw: unknown;
}

export interface CodexAgentMessageItem extends CodexItemBase {
  readonly type: 'agent_message';
  readonly text: string | null;
  readonly phase: string | null;
}

export interface CodexReasoningItem extends CodexItemBase {
  readonly type: 'reasoning';
  readonly text: string | null;
  readonly summary: readonly string[];
}

export interface CodexCommandExecutionItem extends CodexItemBase {
  readonly type: 'command_execution';
  readonly command: string | null;
  readonly status: string | null;
  readonly aggregatedOutput: string | null;
  readonly exitCode: number | null;
}

export interface CodexFileChangeItem extends CodexItemBase {
  readonly type: 'file_change';
  readonly status: string | null;
  readonly changes: readonly unknown[];
}

export interface CodexMcpToolCallItem extends CodexItemBase {
  readonly type: 'mcp_tool_call';
  readonly server: string | null;
  readonly tool: string | null;
  readonly arguments: unknown;
  readonly result: unknown;
  readonly status: string | null;
}

export interface CodexCollaborationToolCallItem extends CodexItemBase {
  readonly type: 'collab_tool_call';
  readonly tool: string | null;
  readonly receiver: string | null;
  readonly prompt: string | null;
  readonly result: unknown;
  readonly status: string | null;
}

export interface CodexWebSearchItem extends CodexItemBase {
  readonly type: 'web_search';
  readonly query: string | null;
  readonly result: unknown;
}

export interface CodexTodoListItem extends CodexItemBase {
  readonly type: 'todo_list';
  readonly items: readonly unknown[];
}

export interface CodexItemError extends CodexItemBase {
  readonly type: 'error';
  readonly message: string | null;
}

export interface CodexUnknownItem extends CodexItemBase {
  readonly type: 'unknown';
  readonly originalType: string | null;
  readonly details: unknown;
}

export type CodexItem =
  | CodexAgentMessageItem
  | CodexReasoningItem
  | CodexCommandExecutionItem
  | CodexFileChangeItem
  | CodexMcpToolCallItem
  | CodexCollaborationToolCallItem
  | CodexWebSearchItem
  | CodexTodoListItem
  | CodexItemError
  | CodexUnknownItem;

export type CodexEvent =
  | {
      readonly type: 'thread.started';
      readonly threadId: string | null;
      readonly raw: unknown;
    }
  | {
      readonly type: 'turn.started';
      readonly raw: unknown;
    }
  | {
      readonly type: 'turn.completed';
      readonly usage: CodexUsage | null;
      readonly raw: unknown;
    }
  | {
      readonly type: 'turn.failed';
      readonly message: string | null;
      readonly raw: unknown;
    }
  | {
      readonly type: 'item.started' | 'item.updated' | 'item.completed';
      readonly item: CodexItem;
      readonly raw: unknown;
    }
  | {
      readonly type: 'error';
      readonly message: string | null;
      readonly raw: unknown;
    }
  | {
      readonly type: 'unknown';
      readonly eventType: string | null;
      readonly raw: unknown;
    };

export interface CodexParsedOutput {
  readonly format: CodexOutputFormat;
  readonly text: string | null;
  readonly events: readonly CodexEvent[];
  readonly threadId: string | null;
  readonly usage: CodexUsage | null;
  readonly raw: string | readonly unknown[];
}

export interface CodexHealth {
  readonly executable: string;
  readonly available: boolean;
  readonly version: string;
  readonly authenticated: 'authenticated' | 'unauthenticated' | 'unknown';
  readonly doctor: unknown;
  readonly doctorExitCode: number | null;
  readonly diagnostic: string | null;
}
