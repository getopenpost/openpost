import { AnalyticsChoices } from "@/components/telemetry";
import { SectionNav } from "@/components/section-nav";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";
import { BrandMark } from "@/components/brand-mark";

export default function Layout({ children }: { children: React.ReactNode }) {
  const tree = source.getPageTree();
  const home = tree.children.find((node) => node.type === "page" && node.url === "/");
  const docsTree = {
    ...tree,
    children: tree.children
      .filter((node) => node !== home)
      .map((node) =>
        node.type === "folder" && node.name === "Guides" && home?.type === "page"
          ? { ...node, index: home, children: [{ ...home, name: "Overview" }, ...node.children] }
          : node,
      ),
  };
  return (
    <>
      <SectionNav />
      <DocsLayout
        tree={docsTree}
        tabs={false}
        nav={{
          title: (
            <span className="docs-brand">
              <BrandMark size={24} />
              OpenPost<span className="docs-brand-label">Docs</span>
            </span>
          ),
        }}
        sidebar={{
          collapsible: false,
          defaultOpenLevel: 0,
          footer: <AnalyticsChoices key="analytics-choices" />,
        }}
        githubUrl="https://github.com/getopenpost/openpost"
      >
        {children}
      </DocsLayout>
    </>
  );
}
