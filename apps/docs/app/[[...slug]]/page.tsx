import { OpenAPIPage } from "@/components/api-page";
import type { OpenAPIPageProps } from "fumadocs-openapi/ui";
import { docsPath, docsSiteUrl, docsSocialImageUrlForRoute } from "@openpost/social-images";
import { source, documentationIcon } from "@/lib/source";
import { openapi } from "@/lib/openapi";
import { operationDocument } from "@/lib/api-document";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import { MarkdownCopyButton, ViewOptionsPopover } from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

const featureMarks: Record<string, string> = {
  "guides/quickstart.mdx": docsPath("/assets/brand/features/compose.svg"),
  "guides/publishing.mdx": docsPath("/assets/brand/features/compose.svg"),
  "image-editor/index.mdx": docsPath("/assets/brand/features/image-editor.svg"),
  "video-editor/index.mdx": docsPath("/assets/brand/features/video-editor.svg"),
  "guides/scheduling.mdx": docsPath("/assets/brand/features/calendar.svg"),
  "guides/analytics.mdx": docsPath("/assets/brand/features/analytics.svg"),
  "guides/media-library.mdx": docsPath("/assets/brand/features/media.svg"),
  "guides/inbox.mdx": docsPath("/assets/brand/features/inbox.svg"),
  "guides/accounts.mdx": docsPath("/assets/brand/features/accounts.svg"),
  "guides/workspaces.mdx": docsPath("/assets/brand/features/workspaces.svg"),
  "automate/index.mdx": docsPath("/assets/brand/features/automation.svg"),
};

type Props = { params: Promise<{ slug?: string[] }> };
export default async function Page({ params }: Props) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full} tabIndex={-1}>
      <div className="docs-page-heading">
        <DocsTitle>
          {featureMarks[page.path] ? (
            <img
              src={featureMarks[page.path]}
              alt=""
              aria-hidden="true"
              width={36}
              height={36}
              className="docs-feature-mark"
            />
          ) : (
            <span className="docs-title-icon" aria-hidden="true">
              {documentationIcon(page.data.icon)}
            </span>
          )}
          <span>{page.data.title}</span>
        </DocsTitle>
        <div className="page-actions">
          {!page.data._openapi && (
            <MarkdownCopyButton markdownUrl={`/${page.path.replace(/\.mdx?$/, ".md")}`}>
              Copy page
            </MarkdownCopyButton>
          )}
          <ViewOptionsPopover
            aria-label="Open page options"
            markdownUrl={page.data._openapi ? undefined : `/${page.path.replace(/\.mdx?$/, ".md")}`}
            githubUrl={
              page.data._openapi
                ? undefined
                : `https://github.com/getopenpost/openpost/edit/main/apps/docs/content/docs/${page.path}`
            }
          >
            Ask AI
          </ViewOptionsPopover>
        </div>
      </div>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={{
            ...defaultMdxComponents,
            OpenAPIPage: async (props: OpenAPIPageProps) => {
              const schema = await openapi.getSchema("openpost");
              return (
                <OpenAPIPage
                  {...props}
                  preloaded={{
                    docs: { openpost: operationDocument(schema.bundled, props.operations ?? []) },
                  }}
                />
              );
            },
          }}
        />
      </DocsBody>
      <div className="docs-page-help">
        <span>Need a hand?</span>
        <a href={docsPath("/guides/troubleshooting")}>Troubleshooting</a>
        <a href="https://github.com/getopenpost/openpost/issues">Report an issue</a>
      </div>
    </DocsPage>
  );
}
export function generateStaticParams() {
  return source.generateParams();
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  const title = page.data.title;
  const description = page.data.description;
  const canonical = page.url === "/" ? docsSiteUrl : `${docsSiteUrl}${page.url}`;
  const image = docsSocialImageUrlForRoute(page.url);
  return {
    title,
    description,
    alternates: {
      canonical,
      types: {
        "text/plain": [
          { url: "/llms.txt", title: "OpenPost documentation index" },
          { url: "/llms-full.txt", title: "OpenPost documentation" },
        ],
        ...(!page.data._openapi
          ? { "text/markdown": `/${page.path.replace(/\.mdx?$/, ".md")}` }
          : {}),
      },
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "OpenPost Docs",
      type: "website",
      images: [{ url: image, width: 1200, height: 630, type: "image/png", alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
  };
}
