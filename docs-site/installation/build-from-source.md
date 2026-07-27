# Build From Source

This path is useful for contributors and advanced operators.

## Build the frontend

```bash
git clone https://github.com/rodrgds/openpost.git
cd openpost
pnpm install
pnpm --filter @openpost/web build
```

## Build the backend

```bash
cd backend
cp .env.example .env
go build -o ../openpost ./cmd/openpost
cd ..
./openpost
```

## Notes

- The frontend build output is embedded into the Go binary.
- For local split frontend/backend development, use the dev workflow in [development/setup](/development/setup).
