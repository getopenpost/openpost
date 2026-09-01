const path = require("node:path");
const { describe, expect, it } = require("bun:test");
const config = require("../metro.config");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");

describe("mobile Metro workspace resolution", () => {
  it("watches both shared Query packages", () => {
    expect(config.watchFolders).toEqual([
      path.join(workspaceRoot, "packages", "api-contract"),
      path.join(workspaceRoot, "packages", "query-catalog"),
    ]);
  });

  it("resolves mobile dependencies before root workspace dependencies", () => {
    expect(config.resolver.disableHierarchicalLookup).toBe(false);
    expect(config.resolver.nodeModulesPaths).toEqual([
      path.join(projectRoot, "node_modules"),
      path.join(workspaceRoot, "node_modules"),
    ]);

    let forwardedContext;
    const resolved = config.resolver.resolveRequest(
      {
        resolveRequest(context, moduleName, platform) {
          forwardedContext = context;
          return { filePath: `${moduleName}.${platform}.js`, type: "sourceFile" };
        },
      },
      "@tanstack/query-core",
      "android",
    );

    expect(forwardedContext).toMatchObject({
      disableHierarchicalLookup: true,
      nodeModulesPaths: [
        path.join(projectRoot, "node_modules"),
        path.join(workspaceRoot, "node_modules"),
      ],
    });
    expect(resolved).toEqual({
      filePath: "@tanstack/query-core.android.js",
      type: "sourceFile",
    });
  });
});
