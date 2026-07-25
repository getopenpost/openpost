# Contributing to OpenPost

Thank you for your interest in contributing to OpenPost! This document outlines how to set up your development environment, make changes, and submit them for review.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/rodrgds/openpost.git
cd openpost

# Install dependencies
devenv shell
install

# Copy environment file
cp backend/.env.example backend/.env

# Run app + backend + docs site
dev
```

The frontend runs on `http://localhost:5173`, the backend on `http://localhost:8080`, and the VitePress docs site on `http://localhost:4174`.

## Development Setup

### Prerequisites

- **Go 1.25+** — For the backend
- **pnpm 11+** — The repository-pinned frontend package manager
- **Git** — Version control

### Running Tests

```bash
# Backend tests
cd backend && go test ./...

# Frontend tests
pnpm --filter @openpost/web test
```

### Linting

```bash
# Go linting (requires golangci-lint)
cd backend && golangci-lint run

# Frontend linting and type checks
pnpm --filter @openpost/web lint
pnpm --filter @openpost/web check
```

## Code Style and Conventions

We follow specific conventions to maintain consistency across the codebase:

### Go Backend

- **Framework:** Echo for HTTP handlers, Huma for OpenAPI spec generation
- **ORM:** Bun for SQLite and Postgres operations
- **Architecture:** Handlers → Services → Database (dependency injection pattern)
- **Platform adapters:** All social platform integrations go in `internal/platform/`
- **Error handling:** Use structured errors with proper HTTP status codes

See [AGENTS.md](AGENTS.md) for detailed architecture guidance.

### SvelteKit Frontend

- **Version:** Svelte 5 with runes (`$state`, `$derived`, `$effect`, `$props`)
- **Styling:** TailwindCSS
- **API client:** openapi-fetch against `/api/v1` routes
- **Patterns:** Use `+page.svelte` and `+page.ts` file structures

See [AGENTS.md](AGENTS.md) for Svelte-specific guidelines.

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new platform adapter for Threads
fix: resolve media upload timeout issue
chore: update Go dependencies
refactor: simplify OAuth callback handling
docs: add platform-specific setup instructions
```

- `feat:` — New features
- `fix:` — Bug fixes
- `chore:` — Maintenance, dependencies
- `refactor:` — Code improvements without behavior changes
- `docs:` — Documentation only
- `test:` — Adding or updating tests

### Branch Naming

Use Conventional Branches:

- `feature/add-threads-support`
- `fix/media-upload-timeout`
- `hotfix/security-patch`
- `docs/update-readme`

## Submitting Changes

### Pull Request Process

1. **Create a branch** from `main`
2. **Make your changes** following the code style guidelines
3. **Test your changes** locally
4. **Run linting and tests** to ensure code quality
5. **Commit with conventional messages**
6. **Open a Pull Request** with a clear description
7. **Respond to feedback** and make updates as needed

### Pull Request Checklist

- [ ] Tests pass (backend and frontend)
- [ ] Linting passes
- [ ] Documentation updated if needed
- [ ] No hardcoded secrets or credentials
- [ ] Migration notes included if database schema changes
- [ ] Platform-specific impact considered (X, Mastodon, Bluesky, LinkedIn, Threads)

### What to include in PR descriptions

- **Summary:** What does this change do?
- **Motivation:** Why is this needed?
- **Testing:** How did you test it?
- **Screenshots:** If UI changes, include before/after
- **Breaking changes:** Note any breaking changes

## Types of Contributions

### Bug Reports

- Use GitHub Issues with the "bug" template
- Include steps to reproduce
- Mention your environment (OS, Go version, etc.)
- Include relevant logs

### Feature Requests

- Use GitHub Issues with the "feature" template
- Describe the use case
- Explain why this would be valuable
- Suggest a possible implementation

### Documentation

- Improve the documentation site in `docs-site/`
- Add platform-specific setup guides
- Fix typos and clarify existing content

### Code Contributions

- New platform adapters
- UI improvements
- Backend optimizations
- Test coverage improvements

## Getting Help

- **Discussions:** Use GitHub Discussions for questions
- **Issues:** Use GitHub Issues for bugs and features
- **Documentation:** Check the [docs-site/](docs-site/) source and the published docs site

## Recognition

Contributors will be recognized in the project. Thank you for your help!
