import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'DNR Agent v2 · policy-controlled post-purchase agent',
  description: 'A tool-calling agent for "delivered but not received" claims. The LLM gathers evidence and explains; deterministic code decides. Synthetic data, simulated refunds.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
