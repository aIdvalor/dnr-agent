import type { NextConfig } from 'next';
// Static export only: the public demo is HTML/CSS/JS plus recorded JSON in public/demo. There are no API routes,
// so nothing in the deployed site can call a model or spend a key. The live path is a local CLI (scripts/live.ts).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;
const config: NextConfig = { output: 'export', basePath, trailingSlash: true, images: { unoptimized: true } };
export default config;
