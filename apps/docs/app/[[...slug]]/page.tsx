import { OpenAPIPage } from "@/components/api-page";
import type { OpenAPIPageProps } from "fumadocs-openapi/ui";
import { resolveDocsSocial } from "@openpost/social-images";
import { source } from "@/lib/source";
import { openapi } from "@/lib/openapi";
import { operationDocument } from "@/lib/api-document";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import { MarkdownCopyButton, ViewOptionsPopover } from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

const featureMarks: Record<string, string> = {
  "guides/quickstart.mdx": "/assets/brand/features/compose.svg",
  "guides/publishing.mdx": "/assets/brand/features/compose.svg",
  "guides/image-editor.mdx": "/assets/brand/features/image-editor.svg",
  "guides/video-editor.mdx": "/assets/brand/features/video-editor.svg",
  "guides/scheduling.mdx": "/assets/brand/features/calendar.svg",
  "guides/analytics.mdx": "/assets/brand/features/analytics.svg",
  "guides/media-library.mdx": "/assets/brand/features/media.svg",
  "guides/inbox.mdx": "/assets/brand/features/inbox.svg",
  "guides/accounts.mdx": "/assets/brand/features/accounts.svg",
  "guides/recording.mdx": "/assets/brand/features/recorder.svg",
  "guides/workspaces.mdx": "/assets/brand/features/workspaces.svg",
  "guides/automation.mdx": "/assets/brand/features/automation.svg",
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
          {featureMarks[page.path] && (
            <img
              src={featureMarks[page.path]}
              alt=""
              aria-hidden="true"
              width={36}
              height={36}
              className="docs-feature-mark"
            />
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
        <a href="/guides/troubleshooting">Troubleshooting</a>
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
  const canonical = `https://docs.openpo.st${page.url}`;
  const image = resolveDocsSocial({
    page: page.data._openapi ? "api-reference/index.mdx" : page.path,
    title,
    description,
  }).imageUrl;
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
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
