import { createOpenAPI } from "fumadocs-openapi/server";

export const openapi = createOpenAPI({ input: { openpost: "./public/openapi.json" } });
