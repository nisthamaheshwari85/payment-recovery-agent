import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Payment Recovery Agent — Razorpay AI Buildathon 2026',
  description:
    'Defensive AI Revenue Recovery Agent for Razorpay test-mode transactions. Classifies failure root causes, computes recoverability scores, enforces 5 non-negotiable guardrails, and drives bounded Hinglish conversational outreach.',
  keywords: [
    'Razorpay',
    'AI Revenue Recovery',
    'Payment Recovery',
    'Hinglish Conversational AI',
    'Buildathon 2026',
    'Next.js',
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
