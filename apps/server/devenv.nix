{
  pkgs,
  ...
}:

{
  languages.go = {
    enable = true;
    package = pkgs.go_1_27;
  };

  packages = [
    pkgs.golangci-lint
    pkgs.gotools
  ];
}
