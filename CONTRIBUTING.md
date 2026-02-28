# Contributing to P402 Protocol

Thank you for your interest in contributing! This document covers how to report bugs, propose features, and submit pull requests.

## Before You Start

- Check [existing issues](https://github.com/Z333Q/p402-protocol/issues) before opening a new one
- For security vulnerabilities, follow the process in [SECURITY.md](SECURITY.md) — do not open a public issue
- For questions, open a Discussion rather than an Issue

## Packages

This is an npm workspace monorepo:
- `packages/sdk` — `@p402/sdk` TypeScript SDK
- `packages/cli` — `@p402/cli` CLI tool

## Development Setup

```bash
git clone https://github.com/Z333Q/p402-protocol.git
cd p402-protocol
npm install
```

Type-check all packages:
```bash
npm run typecheck
```

Build all packages:
```bash
npm run build
```

Run the CLI in dev mode (no build needed):
```bash
cd packages/cli
npx tsx src/index.ts --help
```

## Making Changes

1. Fork the repo and create a branch: `git checkout -b fix/your-fix-name`
2. Make your changes
3. Run `npm run typecheck` — no TypeScript errors allowed
4. Update relevant docs if you changed public API
5. Add or update examples if behavior changed
6. Commit with a descriptive message

## Pull Request Guidelines

- Keep PRs focused — one logical change per PR
- Reference the issue your PR addresses (e.g., `Closes #42`)
- Include a brief description of what changed and why
- Make sure `npm run typecheck` passes
- Don't bump version numbers in PRs — maintainers handle releases

## Reporting Bugs

Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.yml). Include:
- SDK/CLI version (`npm list @p402/sdk`)
- Node.js version (`node --version`)
- Minimal reproduction steps
- Expected vs actual behavior

## Proposing Features

Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.yml). Describe:
- The use case you're solving
- Your proposed API shape (TypeScript interface preferred)
- Alternatives you've considered

## Code Style

- TypeScript strict mode — no `any`, guard all index access
- No external runtime dependencies added to the SDK (it has only `viem` as a peer dep)
- CLI dependencies must be justified — keep the install size minimal
- Match existing code formatting — the repo uses default TypeScript/ESLint settings

## Release Process

Maintainers publish new versions by pushing a tag:
- `sdk/v1.2.3` → triggers publish of `@p402/sdk@1.2.3`
- `cli/v1.2.3` → triggers publish of `@p402/cli@1.2.3`

## License

By contributing, you agree your contributions are licensed under [MIT](LICENSE).
