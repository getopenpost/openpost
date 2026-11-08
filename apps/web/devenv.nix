{
  pkgs,
  lib,
  ...
}:
let
  linux = pkgs.stdenv.hostPlatform.isLinux;
in
{
  languages.javascript = {
    enable = true;
    bun.enable = true;
  };

  # Playwright's downloaded browsers need FHS libraries that Linux Nix shells
  # lack, so Linux uses the Nix Chromium. Prebuilt npm addons such as sharp
  # link libstdc++, which Nix's Bun cannot find on its own.
  packages = lib.optionals linux [ pkgs.chromium ];
  env = lib.optionalAttrs linux {
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = lib.getExe pkgs.chromium;
    LD_LIBRARY_PATH = lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ];
  };
}
