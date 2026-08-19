import { describe, expect, it } from 'vitest';
import { CodexCliClient } from '../../src/index.js';

describe('optional local Codex CLI E2E', () => {
  it.skipIf(process.env.CODEX_E2E !== '1')(
    'runs an explicitly enabled read-only request',
    async () => {
      const client = new CodexCliClient({ timeoutMs: 120_000 });
      const result = await client.ask({
        prompt: 'Reply with the single word ready. Do not inspect or modify files.',
        outputFormat: 'text',
      });

      expect(result.ok).toBe(true);
    },
  );
});
