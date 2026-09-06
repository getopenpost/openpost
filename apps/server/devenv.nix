{
  pkgs,
  ...
}:

{
  languages.go = {
    enable = true;
    package = pkgs.go_1_26;
  };

  packages = [
    pkgs.golangci-lint
    pkgs.gotools
    pkgs.sqlc
  ];
}
