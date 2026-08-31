export const releaseGitHubRepository = "getopenpost/openpost";

export function releaseCommandEnvironment(baseEnvironment = process.env, extraEnvironment = {}) {
  return {
    ...baseEnvironment,
    ...extraEnvironment,
    GH_REPO: releaseGitHubRepository,
  };
}
