# Internal Development Documents

> **Looking for product documentation?** Visit [`apps/docs/`](../apps/docs/) (the Starlight site at [docs.hisaabo.in](https://docs.hisaabo.in)) or [`apps/api-docs/`](../apps/api-docs/) (the API reference at [api-docs.hisaabo.in](https://api-docs.hisaabo.in)).

This folder contains **internal architecture documents, audit reports, and design plans** for Hisaabo contributors. These are not user-facing — they document design decisions, security posture, and implementation plans.

## Contents

### Architecture
- [`architecture/cli-mcp-design.md`](architecture/cli-mcp-design.md) — CLI tool + MCP server architecture (ADRs, package structure, tool schemas)
- [`architecture/testing-plan.md`](architecture/testing-plan.md) — Test infrastructure design (Vitest/Jest setup, coverage strategy, CI integration)
- [`architecture/ai-features-roadmap.md`](architecture/ai-features-roadmap.md) — AI feature implementation plans (HSN auto-fill, photo-to-item, product photography)

### Audits
- [`compliance-audit.md`](compliance-audit.md) — Indian regulatory compliance assessment (GST, DPDPA, financial accuracy)
- [`security-cross-tenant-audit.md`](security-cross-tenant-audit.md) — Multi-tenant isolation verification (every endpoint checked)
- [`usability-audit-web.md`](usability-audit-web.md) — Web app UX findings and recommendations
- [`usability-audit-mobile.md`](usability-audit-mobile.md) — Mobile app UX findings and recommendations

### Deployment
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — Production deployment guide (Docker, ONCE, Cloudflare Pages)

## For contributors

These docs help you understand **why** things are built the way they are. Before making significant changes to any area, check if there's an architecture doc covering it — it'll save you time and help your PR get reviewed faster.
