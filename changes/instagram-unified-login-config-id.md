### Added

- Instagram connections through Facebook Login now support Meta's Unified Login for newly created Meta apps: provider app entries accept a `config_id`, and the consent dialog is built from the Facebook Login for Business configuration instead of explicit scopes. Apps created before Meta's change keep working unchanged; end-to-end verification against a fresh Meta app is tracked separately (#495).
