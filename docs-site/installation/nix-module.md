# Nix Module

OpenPost can also be deployed through a NixOS module. This is the production setup behind `https://app.openpost.social` (my instance).

## What this example shows

- Running OpenPost as an OCI container
- Persisting SQLite and media storage under `/var/lib/openpost`
- Supplying secrets through `sops`
- Wiring public callback and media URLs to the deployed domain
- Exposing the service through your existing reverse proxy layer

## Current module

<!--@include: ../.generated/openpost-nix-module.md-->
