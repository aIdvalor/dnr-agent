import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], env: { DNR_TOOL_TIMEOUT_MS: '200' } } });
