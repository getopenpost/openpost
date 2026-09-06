{
  pkgs,
  lib,
  ...
}:
{
  languages.javascript = {
    enable = true;
    bun.enable = true;
  };

  packages = lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.chromium ];
  env = lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = lib.getExe pkgs.chromium;
  };
}
