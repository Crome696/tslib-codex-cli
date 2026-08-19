import { CodexParseError, sanitizeDiagnostic } from './errors.js';
import type {
  CodexAgentMessageItem,
  CodexCollaborationToolCallItem,
  CodexCommandExecutionItem,
  CodexEvent,
  CodexFileChangeItem,
  CodexItem,
  CodexItemError,
  CodexMcpToolCallItem,
  CodexOutputFormat,
  CodexParsedOutput,
  CodexReasoningItem,
  CodexTodoListItem,
  CodexUnknownItem,
  CodexUsage,
  CodexWebSearchItem,
} from './types.js';

export function parseCodexEvent(value: unknown): CodexEvent {
  if (!isRecord(value) || typeof value.type !== 'string' || value.type.length === 0) {
    throw new CodexParseError('Codex JSONL event must be an object with a non-empty type.');
  }

  switch (value.type) {
    case 'thread.started':
      return {
        type: 'thread.started',
        threadId: stringValue(value.thread_id) ?? stringValue(value.threadId),
        raw: value,
      };
    case 'turn.started':
      return { type: 'turn.started', raw: value };
    case 'turn.completed':
      return { type: 'turn.completed', usage: parseUsage(value.usage), raw: value };
    case 'turn.failed':
      return {
        type: 'turn.failed',
        message: extractMessage(value.error) ?? stringValue(value.message),
        raw: value,
      };
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      return { type: value.type, item: parseItem(value.item), raw: value };
    case 'error':
      return {
        type: 'error',
        message: extractMessage(value.error) ?? stringValue(value.message),
        raw: value,
      };
    default:
      return { type: 'unknown', eventType: value.type, raw: value };
  }
}

export function parseCodexOutput(stdout: string, format: CodexOutputFormat): CodexParsedOutput {
  if (format === 'text') {
    return {
      format,
      text: stdout.trimEnd(),
      events: [],
      threadId: null,
      usage: null,
      raw: stdout,
    };
  }

  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new CodexParseError('Codex JSONL output was empty.');
  }

  const events: CodexEvent[] = [];
  const raw: unknown[] = [];
  let threadId: string | null = null;
  let usage: CodexUsage | null = null;
  let text: string | null = null;

  for (const [index, line] of lines.entries()) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(line) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid JSON';
      throw new CodexParseError(
        `Invalid Codex JSONL at line ${index + 1}: ${sanitizeDiagnostic(message)}`,
      );
    }

    raw.push(decoded);
    const event = parseCodexEvent(decoded);
    events.push(event);

    if (event.type === 'thread.started' && event.threadId !== null) {
      threadId = event.threadId;
    }
    if (event.type === 'turn.completed' && event.usage !== null) {
      usage = event.usage;
    }
    if (
      event.type === 'item.started' ||
      event.type === 'item.updated' ||
      event.type === 'item.completed'
    ) {
      if (event.item.type === 'agent_message' && event.item.text !== null) {
        text = event.item.text;
      }
    }
  }

  return {
    format,
    text,
    events,
    threadId,
    usage,
    raw,
  };
}

export function parseCodexVersion(output: string): string | null {
  const match = output.match(/\b(?:codex(?:-cli)?\s+)?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/i);
  return match?.[1] ?? null;
}

function parseItem(value: unknown): CodexItem {
  if (!isRecord(value)) {
    return {
      id: null,
      type: 'unknown',
      originalType: null,
      details: value,
      raw: value,
    } satisfies CodexUnknownItem;
  }

  const itemType = stringValue(value.type);
  const base = { id: stringValue(value.id), raw: value };

  switch (itemType) {
    case 'agent_message':
      return {
        ...base,
        type: 'agent_message',
        text: extractText(value.text ?? value.content ?? value.message),
        phase: stringValue(value.phase),
      } satisfies CodexAgentMessageItem;
    case 'reasoning':
      return {
        ...base,
        type: 'reasoning',
        text: extractText(value.text ?? value.content),
        summary: extractStringList(value.summary),
      } satisfies CodexReasoningItem;
    case 'command_execution':
      return {
        ...base,
        type: 'command_execution',
        command: stringValue(value.command),
        status: stringValue(value.status),
        aggregatedOutput:
          stringValue(value.aggregated_output) ?? stringValue(value.aggregatedOutput),
        exitCode: numberValue(value.exit_code) ?? numberValue(value.exitCode),
      } satisfies CodexCommandExecutionItem;
    case 'file_change':
      return {
        ...base,
        type: 'file_change',
        status: stringValue(value.status),
        changes: arrayValue(value.changes),
      } satisfies CodexFileChangeItem;
    case 'mcp_tool_call':
      return {
        ...base,
        type: 'mcp_tool_call',
        server: stringValue(value.server) ?? stringValue(value.server_name),
        tool: stringValue(value.tool) ?? stringValue(value.tool_name),
        arguments: value.arguments ?? value.input ?? null,
        result: value.result ?? value.output ?? null,
        status: stringValue(value.status),
      } satisfies CodexMcpToolCallItem;
    case 'collab_tool_call':
    case 'collaboration_tool_call':
      return {
        ...base,
        type: 'collab_tool_call',
        tool: stringValue(value.tool) ?? stringValue(value.name),
        receiver: stringValue(value.receiver) ?? stringValue(value.receiver_thread_id),
        prompt: extractText(value.prompt),
        result: value.result ?? value.output ?? null,
        status: stringValue(value.status),
      } satisfies CodexCollaborationToolCallItem;
    case 'web_search':
      return {
        ...base,
        type: 'web_search',
        query: stringValue(value.query),
        result: value.result ?? value.results ?? null,
      } satisfies CodexWebSearchItem;
    case 'todo_list':
      return {
        ...base,
        type: 'todo_list',
        items: arrayValue(value.items ?? value.todos),
      } satisfies CodexTodoListItem;
    case 'error':
      return {
        ...base,
        type: 'error',
        message: extractMessage(value.error) ?? stringValue(value.message),
      } satisfies CodexItemError;
    default:
      return {
        ...base,
        type: 'unknown',
        originalType: itemType,
        details: value,
      } satisfies CodexUnknownItem;
  }
}

function parseUsage(value: unknown): CodexUsage | null {
  if (!isRecord(value)) {
    return null;
  }

  const inputTokens = numberValue(value.input_tokens) ?? numberValue(value.inputTokens);
  const cachedInputTokens =
    numberValue(value.cached_input_tokens) ?? numberValue(value.cachedInputTokens);
  const outputTokens = numberValue(value.output_tokens) ?? numberValue(value.outputTokens);
  const directTotal = numberValue(value.total_tokens) ?? numberValue(value.totalTokens);

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: directTotal ?? sumNumbers(inputTokens, outputTokens),
    raw: value,
  };
}

function extractMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (isRecord(value)) {
    return extractText(value.message ?? value.detail ?? value.error);
  }
  return null;
}

function extractText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => (isRecord(entry) ? stringValue(entry.text) : stringValue(entry)))
      .filter(isString);
    return parts.length > 0 ? parts.join('') : null;
  }
  if (isRecord(value)) {
    return stringValue(value.text) ?? stringValue(value.message);
  }
  return null;
}

function extractStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => extractText(entry)).filter(isString);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function sumNumbers(first: number | null, second: number | null): number | null {
  return first === null || second === null ? null : first + second;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: string | null): value is string {
  return value !== null;
}
