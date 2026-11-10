import type { NextConfig } from 'next';
const config: NextConfig = { outputFileTracingIncludes: { '/api/**': ['./evals/cases/*.jsonl'] } };
export default config;
