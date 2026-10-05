const path = require("node:path");
const config = require("../../metro.config.js");
const resolve = config.resolver.resolveRequest;
config.watchFolders.push(path.resolve(__dirname, "../../../../tests/app/fixtures"));
config.resolver.resolveRequest = (context, name, platform) => {
  if (name === "expo-secure-store") {
    return { type: "sourceFile", filePath: path.join(__dirname, "storage.js") };
  }
  return resolve(context, name, platform);
};
const rewrite = config.server.rewriteRequestUrl;
config.server.rewriteRequestUrl = (url) => {
  const rewritten = rewrite ? rewrite(url) : url;
  const parsed = new URL(rewritten, "http://localhost");
  if (
    [
      "/.expo/.virtual-metro-entry.bundle",
      "/node_modules/expo-router/entry.bundle",
      "/index.bundle",
      "/main.bundle",
    ].includes(parsed.pathname)
  ) {
    parsed.pathname = "/artifacts/screenshots/entry.bundle";
    return rewritten.startsWith("/") ? parsed.pathname + parsed.search : parsed.toString();
  }
  return rewritten;
};
module.exports = config;
