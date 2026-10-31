import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { docsPath } from "@openpost/social-images";
import { staticActionTexture } from "@openpost/ui/static-action";
import type { CSSProperties } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main
      className="op-recovery"
      data-theme-button="dither"
      style={staticActionTexture as CSSProperties}
    >
      <Link href="/" className="op-recovery-brand">
        <BrandMark />
        OpenPost<span className="docs-brand-label">Docs</span>
      </Link>
      <div className="op-recovery-body">
        <div>
          <h1>Page not found</h1>
          <p className="op-recovery-copy">The link may be old or mistyped.</p>
          <div className="op-recovery-actions">
            <Link href="/" data-static-action data-dither-button="always">
              Back to docs
            </Link>
            <Link href="/guides/quickstart" className="op-recovery-link">
              Quickstart
            </Link>
          </div>
        </div>
        <figure className="op-recovery-art">
          <img
            src={docsPath("/assets/marketing/missing-page.webp")}
            alt=""
            width={768}
            height={768}
          />
          <figcaption className="op-recovery-status">
            404<span className="sr-only"> · Page not found</span>
          </figcaption>
        </figure>
      </div>
    </main>
  );
}
