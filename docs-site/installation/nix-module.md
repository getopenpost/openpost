# Nix Module

OpenPost can also run through a NixOS module. The hosted app at `https://app.openpost.social` uses this setup.

This page is for NixOS operators. The module requires an existing reverse proxy and explicit secret management.

## What this example shows

- Running OpenPost as an OCI container
- Persisting SQLite and media storage under `/var/lib/openpost`
- Supplying secrets through `sops`
- Wiring public callback and media URLs to the deployed domain
- Exposing the service through your existing reverse proxy layer

## Current module

<!--@include: ../.generated/openpost-nix-module.md-->
