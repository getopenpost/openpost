const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);
const dependencyRoots = [
  path.join(projectRoot, "node_modules"),
  path.join(workspaceRoot, "node_modules"),
];

config.watchFolders = [
  path.join(workspaceRoot, "packages", "api-contract"),
  path.join(workspaceRoot, "packages", "query-catalog"),
];
config.resolver.nodeModulesPaths = dependencyRoots;
config.resolver.resolveRequest = (context, moduleName, platform) =>
  context.resolveRequest(
    { ...context, disableHierarchicalLookup: true, nodeModulesPaths: dependencyRoots },
    moduleName,
    platform,
  );

module.exports = config;
