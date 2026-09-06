const { withAppBuildGradle } = require("expo/config-plugins");

const DEFAULT_RELEASE_SIGNING = "signingConfig signingConfigs.debug";
const OPTIONAL_RELEASE_SIGNING = [
  "if ((findProperty('openpostDebugSigning') ?: 'false').toBoolean()) {",
  "                signingConfig signingConfigs.debug",
  "            }",
].join("\n");

function makeReleaseSigningOptional(contents) {
  const releaseBlocks = [...contents.matchAll(/^\s*release\s*\{/gm)];
  if (releaseBlocks.length !== 1) {
    throw new Error(
      `Expected one Expo release build type, found ${releaseBlocks.length}. Check the generated Android template.`,
    );
  }

  const blockStart = releaseBlocks[0].index;
  const openingBrace = contents.indexOf("{", blockStart);
  let depth = 0;
  let blockEnd = -1;
  for (let index = openingBrace; index < contents.length; index += 1) {
    if (contents[index] === "{") depth += 1;
    if (contents[index] === "}") depth -= 1;
    if (depth === 0) {
      blockEnd = index + 1;
      break;
    }
  }

  const releaseBlock = contents.slice(blockStart, blockEnd);
  const occurrences = releaseBlock.split(DEFAULT_RELEASE_SIGNING).length - 1;
  if (blockEnd === -1 || occurrences !== 1) {
    throw new Error(
      `Expected one Expo release signing declaration, found ${occurrences}. Check the generated Android template.`,
    );
  }

  const updatedBlock = releaseBlock.replace(DEFAULT_RELEASE_SIGNING, OPTIONAL_RELEASE_SIGNING);
  return `${contents.slice(0, blockStart)}${updatedBlock}${contents.slice(blockEnd)}`;
}

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (nextConfig) => {
    nextConfig.modResults.contents = makeReleaseSigningOptional(nextConfig.modResults.contents);
    return nextConfig;
  });
};

module.exports.makeReleaseSigningOptional = makeReleaseSigningOptional;
