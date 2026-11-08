{ pkgs, ... }:

# Plain binary-cache packages. devenv's languages.go rebuilds delve and
# several editor tools against the pinned Go, which is slow and fails on Linux.
{
  packages = [
    pkgs.go_1_27
    pkgs.golangci-lint
    pkgs.gopls
  ];
}
