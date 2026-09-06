# Build From Source

Use this path when you want to build OpenPost yourself.

This path requires the repository's pinned Devenv toolchain and enough local resources to build the web and Go projects.

## Set up the project

```bash
git clone https://github.com/getopenpost/openpost.git
cd openpost
direnv allow
devenv shell -- setup
```

## Build OpenPost

```bash
bun run build
```

The build creates the frontend and embeds it in the Go server file.

For local development, use the steps in [Development Setup](/development/setup).
