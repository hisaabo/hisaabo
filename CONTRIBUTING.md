# Contributing to Hisaabo

Thanks for your interest in contributing. Hisaabo is an open-source invoicing app built for Indian SMBs, and we welcome contributions of all kinds.

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker (for local PostgreSQL)
- Git

### Development Setup

```bash
# Fork and clone
git clone https://github.com/<your-username>/hisaabo.git
cd hisaabo

# Install dependencies
pnpm install

# Start PostgreSQL
docker compose up -d

# Configure environment
cp .env.example .env
# Edit .env — the defaults work for local development

# Push schema to database
pnpm db:push

# Start all dev servers
pnpm dev
```

This starts:
- Web app at `http://localhost:5173`
- API at `http://localhost:3000`
- Store at `http://localhost:5174`

### Useful Commands

```bash
pnpm dev              # Start all dev servers
pnpm build            # Build all packages
pnpm typecheck        # Type-check everything
pnpm lint             # Lint everything
pnpm db:push          # Push schema changes (dev)
pnpm db:studio        # Open Drizzle Studio (DB browser)
```

## Project Architecture

```
packages/shared/   →  Zod validators, types, calc, money module (shared by API + web)
packages/db/       →  Drizzle ORM schema + PostgreSQL client
packages/api/      →  Hono server + tRPC routers
apps/web/          →  React 19 SPA (main application)
apps/store/        →  Online store SPA (lightweight, separate)
apps/desktop/      →  Tauri v2 shell
```

**Key patterns:**
- tRPC provides end-to-end type safety — change a schema and TypeScript catches every callsite
- All monetary values are `NUMERIC(15,2)` in PostgreSQL, string in TypeScript, and use the `money` module for arithmetic — never use `parseFloat` for financial calculations
- Business isolation: every query is scoped via `businessProcedure` middleware
- CASL handles role-based access control — check `packages/api/src/lib/permissions.ts`

## How to Contribute

### Reporting Bugs

Open a GitHub issue with:
- Steps to reproduce
- Expected vs actual behavior
- Browser/OS/Node version
- Screenshots if relevant

### Suggesting Features

Open a GitHub issue with the `enhancement` label. Describe:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you considered

### Submitting Code

1. **Fork** the repo and create a branch from `main`
2. **Make your changes** — keep them focused (one feature or fix per PR)
3. **Run checks** before pushing:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm build
   ```
4. **Open a PR** against `main` with a clear description of what changed and why

### What We Look For in PRs

- **Passes typecheck and lint** — no exceptions
- **Focused scope** — one concern per PR. A bug fix doesn't need a refactor.
- **No over-engineering** — don't add abstractions for hypothetical future use
- **Financial correctness** — use the `money` module, never floating point
- **Security awareness** — validate inputs, scope queries, don't expose internal data
- **No component libraries** — we use pure Tailwind CSS, no shadcn/MUI/Radix

## Code Style

- **TypeScript** everywhere — no `any` unless absolutely necessary
- **Tailwind CSS** for styling — CSS custom properties for theming, no CSS-in-JS
- **DM Sans** + **JetBrains Mono** fonts
- **Drizzle ORM** for database queries — no raw SQL unless performance-critical
- **Zod** for all input validation — schemas live in `packages/shared/src/validators.ts`
- **No emojis** in code, comments, or UI
- Prefer explicit over clever — readable code wins

## Areas Where Help is Needed

- **Translations** — Hindi, Tamil, Bengali, Marathi, Gujarati, and other Indian languages
- **Testing** — unit tests, integration tests, E2E tests
- **Documentation** — user guides, API documentation
- **Accessibility** — screen reader support, keyboard navigation improvements
- **Performance** — bundle size optimization, query performance
- **Mobile** — responsive design improvements, PWA enhancements

## License

By contributing, you agree that your contributions will be licensed under the [O'Saasy License](LICENSE).
