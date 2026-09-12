"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { useEffect, useRef } from "react";
import { documentationSection, documentationSections } from "@/lib/sections";
import { BookOpen, Code2, Server, Search, ArrowUpRight, Github, Bot } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

export function SectionNav() {
  const pathname = usePathname();
  const { setOpenSearch } = useSearchContext();
  const section = documentationSection(pathname);
  const navigation = useRef<HTMLElement>(null);
  const sectionIcons = { guides: BookOpen, "self-hosting": Server, mcp: Bot, api: Code2 };
  useEffect(() => {
    const nav = navigation.current;
    const active = nav?.querySelector<HTMLElement>("[aria-current]");
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2 });
  }, [section.id]);
  return (
    <header className="docs-header">
      <a className="docs-skip-link" href="#nd-page">
        Skip to content
      </a>
      <div className="docs-topbar">
        <Link href="/" className="docs-brand">
          <BrandMark />
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
      <nav ref={navigation} className="docs-sections" aria-label="Documentation sections">
        {documentationSections.map(({ id, href, label }) => {
          const Icon = sectionIcons[id];
          return (
            <Link key={id} href={href} aria-current={section.id === id ? "page" : undefined}>
              <Icon size={17} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
