---
id: ravhub-core-agent
role: Backend Engineer
stack:
  - NestJS
  - TypeORM
  - Jest
  - RxJS
testing_standards:
  min_coverage: 85
  mocking_strategy: "strict-unit"
critical_paths:
  - "src/modules/plugins/impl/**/storage.ts"
  - "src/modules/plugins/core/plugin-delegator.service.ts"
coding_standards:
  - "No redundant comments; code must be self-documenting."
  - "Strict adherence to SOLID principles."
  - "Small, focused classes (Single Responsibility)."
  - "Package Management: Use pnpm instead of npm for all commands"
---

# 📂 RavHub Core Context

## 📍 Scope

The Open Source Core API (`apps/api`). The heart of the system.

## 🛠️ Technology Stack

- **Framework**: NestJS (Modular Monolith).
- **Language**: TypeScript (Strict Mode).
- **Database**: PostgreSQL (via TypeORM).
- **Package Manager**: pnpm (Workspace mode).

## 🔌 Plugin System

Located in `src/modules/plugins/`.

- **`PluginContext`**: The API surface exposed to plugins. **Changes here are breaking.**
- **Delegator**: Routes requests based on `repo.type`.

### Active Plugins

- **`npm`**: Hosted, Proxy, Group.
- **`docker`**: V2 Registry API (Standard only). V1 deprecated and removed.
- **`nuget`**: V3 API (OData/JSON) & V2 Protocol Support.
- **`maven`**, **`pypi`**, **`composer`**, **`helm`**, **`rust`**.

## 🧪 Testing Guidelines (Strict)

**Rule**: maintain >85% coverage in Plugins.

### 1. Mocking Strategy

Use `jest.mock`. Do NOT rely on real DB/Storage in Unit Tests.

### 2. Critical Checks

- **Indexing**: explicitly expect `context.indexArtifact` to be called.
- **Proxy**: validate `cache` logic (HIT/MISS).
- **Console**: suppress expected errors.

## 🚨 Known Pitfalls

1. **Artifact Indexing (CRITICAL)**:
   - **Symptom**: `upload` or `put` returns 200 OK, but package is invisible in UI.
   - **Fix**: Ensure EVERY `save()` is followed by an `indexArtifact()` call inside a try/catch.
2. **Proxy Keys**: Improper key usage leads to collision.

## 🧑‍💻 Coding Standards (Local)

1. **SOLID & Small Classes**: Keep Services focused. Break `ReposService` if it grows too large.
2. **No Comments**: Variable names must explain intent.
3. **License Protocol (AGPL-3.0)**: Ensure every file starts with the AGPL-3.0 header. Use `scripts/add-headers.js` to enforce.

---

_Use `pnpm test` to validate changes._
