import { describe, expect, it } from 'vitest';
import { parseCodexEvent, parseCodexOutput, parseCodexVersion } from './parsers.js';

describe('Codex parsers', () => {
  it('normalizes every current lifecycle event family and keeps raw payloads', () => {
    const events = [
      { type: 'thread.started', thread_id: 'thread-1' },
      { type: 'turn.started' },
      {
        type: 'item.started',
        item: { id: 'm-1', type: 'agent_message', text: 'hello', phase: 'final' },
      },
      {
        type: 'item.updated',
        item: { id: 'r-1', type: 'reasoning', summary: ['step'], text: 'thinking' },
      },
      {
        type: 'item.completed',
        item: {
          id: 'c-1',
          type: 'command_execution',
          command: 'pwd',
          aggregated_output: '/tmp',
          exit_code: 0,
        },
      },
      {
        type: 'item.completed',
        item: { id: 'f-1', type: 'file_change', changes: [{ path: 'a.ts' }] },
      },
      {
        type: 'item.completed',
        item: { id: 'mcp-1', type: 'mcp_tool_call', server: 'server', tool: 'tool' },
      },
      { type: 'item.completed', item: { id: 'collab-1', type: 'collab_tool_call', tool: 'send' } },
      { type: 'item.completed', item: { id: 'web-1', type: 'web_search', query: 'Codex' } },
      { type: 'item.completed', item: { id: 'todo-1', type: 'todo_list', items: ['one'] } },
      { type: 'item.completed', item: { id: 'err-1', type: 'error', message: 'failed item' } },
      {
        type: 'turn.completed',
        usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 5 },
      },
      { type: 'turn.failed', error: { message: 'turn failed' } },
      { type: 'error', message: 'top-level error' },
    ];

    const parsed = events.map(parseCodexEvent);

    expect(parsed.map((event) => event.type)).toEqual([
      'thread.started',
      'turn.started',
      'item.started',
      'item.updated',
      'item.completed',
      'item.completed',
      'item.completed',
      'item.completed',
      'item.completed',
      'item.completed',
      'item.completed',
      'turn.completed',
      'turn.failed',
      'error',
    ]);
    expect(parsed[0]).toMatchObject({
      type: 'thread.started',
      threadId: 'thread-1',
      raw: events[0],
    });
    expect(parsed[2]).toMatchObject({
      type: 'item.started',
      item: { type: 'agent_message', text: 'hello' },
    });
    expect(parsed[11]).toMatchObject({
      type: 'turn.completed',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    expect(parsed[12]).toMatchObject({ type: 'turn.failed', message: 'turn failed' });
  });

  it('retains unknown future events and item types without dropping raw data', () => {
    const event = { type: 'future.event', payload: { value: 42 } };
    const itemEvent = parseCodexEvent({
      type: 'item.completed',
      item: { type: 'future_item', value: true },
    });

    expect(parseCodexEvent(event)).toEqual({
      type: 'unknown',
      eventType: 'future.event',
      raw: event,
    });
    expect(itemEvent).toMatchObject({
      type: 'item.completed',
      item: { type: 'unknown', originalType: 'future_item' },
    });
    expect((itemEvent as { raw: unknown }).raw).toEqual({
      type: 'item.completed',
      item: { type: 'future_item', value: true },
    });
  });

  it('parses JSONL output into typed aggregate data', () => {
    const output = [
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-2' }),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: 'final answer' },
      }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 4 } }),
    ].join('\n');

    expect(parseCodexOutput(output, 'jsonl')).toMatchObject({
      format: 'jsonl',
      text: 'final answer',
      threadId: 'thread-2',
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
      raw: expect.any(Array),
    });
  });

  it('rejects empty and malformed JSONL while preserving text output', () => {
    expect(() => parseCodexOutput('', 'jsonl')).toThrow(/empty/i);
    expect(() => parseCodexOutput('{not-json}', 'jsonl')).toThrow(/invalid/i);
    expect(parseCodexOutput('plain output\n', 'text')).toMatchObject({
      format: 'text',
      text: 'plain output',
      events: [],
    });
  });

  it('recognizes Codex CLI semantic versions', () => {
    expect(parseCodexVersion('codex-cli 0.147.0')).toBe('0.147.0');
    expect(parseCodexVersion('codex 1.2.3-beta.1')).toBe('1.2.3-beta.1');
    expect(parseCodexVersion('not a version')).toBeNull();
  });
});
