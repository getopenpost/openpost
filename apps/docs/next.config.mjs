import { createMDX } from "fumadocs-mdx/next";
import path from "node:path";

const withMDX = createMDX();
export default withMDX({
  output: "export",
  agentRules: false,
  images: { unoptimized: true },
  turbopack: { root: path.resolve("../..") },
  experimental: { cpus: 2 },
  env: {
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: process.env.VITE_POSTHOG_PROJECT_TOKEN ?? "",
    NEXT_PUBLIC_POSTHOG_API_HOST: process.env.VITE_POSTHOG_API_HOST ?? "",
    NEXT_PUBLIC_OPENPOST_ENVIRONMENT: process.env.VITE_OPENPOST_ENVIRONMENT ?? "development",
    NEXT_PUBLIC_OPENPOST_REVISION: process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "",
  },
});
