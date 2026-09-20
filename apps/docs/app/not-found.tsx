import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  description:
    "The documentation page you asked for does not exist. Continue from a maintained section.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="docs-not-found">
      <Link href="/" className="docs-brand">
        <BrandMark />
        OpenPost<span className="docs-brand-label">Docs</span>
      </Link>
      <p className="docs-not-found-code">404 · Page not found</p>
      <h1>We couldn&apos;t find that page.</h1>
      <p>The link may be old or the address mistyped. Try one of these instead.</p>
      <div className="docs-not-found-actions">
        <Link href="/" className="docs-not-found-primary">
          Back to documentation home
        </Link>
      </div>
      <nav className="docs-not-found-links" aria-label="Continue from a maintained section">
        <Link href="/guides/quickstart">Quickstart</Link>
        <Link href="/self-hosting">Self-hosting</Link>
        <Link href="/automate">Automate</Link>
        <Link href="/api-reference">API reference</Link>
      </nav>
      <style>{`
        .docs-not-found {
          max-width: 44rem;
          margin-inline: auto;
          padding: clamp(4rem, 8vw, 7rem) 1.5rem;
        }
        .docs-not-found-code {
          margin-top: 2.5rem;
          color: var(--color-fd-primary);
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .docs-not-found h1 {
          margin-top: 1rem;
          font-size: clamp(2.25rem, 6vw, 3.5rem);
          font-weight: 600;
          letter-spacing: -0.03em;
          line-height: 1.05;
          text-wrap: balance;
        }
        .docs-not-found > p {
          margin-top: 1.25rem;
          color: var(--color-fd-muted-foreground);
          line-height: 1.7;
        }
        .docs-not-found-actions {
          margin-top: 2rem;
        }
        .docs-not-found-primary {
          display: inline-flex;
          align-items: center;
          min-height: 44px;
          border-radius: 0.6rem;
          padding: 0.75rem 1.25rem;
          background: var(--color-fd-primary);
          color: var(--color-fd-primary-foreground);
          font-size: 0.875rem;
          font-weight: 600;
        }
        .docs-not-found-links {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem 1.25rem;
          margin-top: 2.5rem;
          padding-top: 1.5rem;
          border-top: 1px solid var(--color-fd-border);
        }
        .docs-not-found-links a {
          display: inline-flex;
          align-items: center;
          min-height: 44px;
          font-size: 0.85rem;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
