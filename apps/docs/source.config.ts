import { defineConfig } from "fumadocs-mdx/config";

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      tokenizeTimeLimit: 0,
    },
  },
});
