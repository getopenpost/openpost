import { OpenAPIPage } from "@/components/api-page";
import type { OpenAPIPageProps } from "fumadocs-openapi/ui";
import { resolveDocsSocial } from "@openpost/social-images";
import { source } from "@/lib/source";
import { openapi } from "@/lib/openapi";
import { operationDocument } from "@/lib/api-document";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import { MarkdownCopyButton } from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

type Props = { params: Promise<{ slug?: string[] }> };
export default async function Page({ params }: Props) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <div className="docs-page-heading">
        <DocsTitle>{page.data.title}</DocsTitle>
        {!page.data._openapi && (
          <div className="page-actions">
            <MarkdownCopyButton markdownUrl={`/${page.path.replace(/\.mdx?$/, ".md")}`} />
            <details className="page-menu">
              <summary aria-label="More page actions">⌄</summary>
              <div>
                <a href={`/${page.path.replace(/\.mdx?$/, ".md")}`}>View Markdown</a>
                <a
                  href={`https://github.com/getopenpost/openpost/edit/main/apps/docs/content/docs/${page.path}`}
                >
                  Edit on GitHub
                </a>
              </div>
            </details>
          </div>
        )}
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
