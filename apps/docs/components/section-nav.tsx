"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { BookOpen, Code2, Server, Search, ArrowUpRight, Github, Bot } from "lucide-react";

export function SectionNav() {
  const pathname = usePathname();
  const { setOpenSearch } = useSearchContext();
  const section = pathname.startsWith("/api-reference")
    ? "api"
    : pathname.startsWith("/self-hosting")
      ? "self-hosting"
      : pathname.startsWith("/mcp")
        ? "mcp"
        : "guides";
  return (
    <header className="docs-header">
      <div className="docs-topbar">
        <Link href="/" className="docs-brand">
          <img src="/assets/brand/icon.svg" width="28" height="28" alt="" />
          OpenPost<span className="docs-brand-label">Docs</span>
        </Link>
        <button type="button" className="docs-search" onClick={() => setOpenSearch(true)}>
          <Search size={17} />
          <span>Search documentation...</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="docs-header-actions">
          <a href="https://github.com/getopenpost/openpost" className="docs-github">
            <Github size={16} />
            GitHub
          </a>
          <a href="https://app.openpo.st" className="docs-open-app">
            Open OpenPost
            <ArrowUpRight size={16} />
          </a>
        </div>
      </div>
      <nav className="docs-sections" aria-label="Documentation sections">
        <Link href="/" aria-current={section === "guides" ? "page" : undefined}>
          <BookOpen size={17} />
          Guides
        </Link>
        <Link href="/self-hosting" aria-current={section === "self-hosting" ? "page" : undefined}>
          <Server size={17} />
          Self-hosting
        </Link>
        <Link href="/mcp" aria-current={section === "mcp" ? "page" : undefined}>
          <Bot size={17} />
          AI assistants
        </Link>
        <Link href="/api-reference" aria-current={section === "api" ? "page" : undefined}>
          <Code2 size={17} />
          API reference
        </Link>
      </nav>
    </header>
  );
}
