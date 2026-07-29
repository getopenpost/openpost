# Build From Source

Use this path when you want to build OpenPost yourself.

## Set up the project

```bash
git clone https://github.com/rodrgds/openpost.git
cd openpost
direnv allow
devenv shell -- setup
```

## Build OpenPost

```bash
devenv shell -- build
```

The build creates the frontend and embeds it in the Go server file.

For local development, use the steps in [Development Setup](/development/setup).
