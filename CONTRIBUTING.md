<div align="center">

# Contributing to RavHub / Contribuir a RavHub

[English](#english) | [Español](#español)

</div>

---

<a name="english"></a>

## 🇬🇧 Contributing to RavHub

First of all, thank you for your interest in RavHub! 🎉

`ravhub-core` is public and source-available to the community under the AGPL, but its source code is maintained by the project author. For that reason, external source code pull requests are not currently accepted.

What is welcome:

- Bug reports with clear reproduction steps
- Feature requests and product feedback
- Architecture discussions
- Documentation reports and clarifications

If you want something added to core, please open an issue or discussion. The maintainer may implement the change directly.

Copyright for `ravhub-core` should remain attributed to the legal owner of the project. Before running the repository header tooling, set `RAVHUB_COPYRIGHT_HOLDER` to the exact legal name that should appear in source headers.

### 🛠️ Development Setup

RavHub is a monorepo built with:

- **Backend**: NestJS (Node.js)
- **Frontend**: React + Vite
- **Database**: PostgreSQL
- **Package Manager**: pnpm

#### Prerequisites

- Node.js 22+
- Docker & Docker Compose
- pnpm (`npm install -g pnpm`)

#### Getting Started

1. **Fork and Clone**

   ```bash
   git clone https://github.com/your-username/ravhub-core.git
   cd ravhub-core
   ```

2. **Install Dependencies**

   ```bash
   pnpm install
   ```

3. **Start Development Environment**
   This will start PostgreSQL, Redis, API (watch mode), and Web (watch mode).

   ```bash
   docker compose -f docker-compose.dev.yml up --build
   ```

   - API: `http://localhost:3000`
   - Frontend: `http://localhost:5173`

### 🧪 Running Tests

If you are preparing a bug report, reproduction case, or documentation proposal, please verify your environment and include the relevant test output when possible.

#### Unit Tests

```bash
# Run API tests
pnpm --filter api test

# Run Web tests
pnpm --filter web test
```

#### E2E Tests

```bash
# Ensure the stack is running first
pnpm --filter api test:e2e
```

#### Full Automated Suite

```bash
pnpm test:full
```

This command starts the development stack when needed, waits for API and Web readiness, and then runs API unit tests, Web unit tests, API e2e tests, frontend Playwright tests, and all shell E2E scenarios in sequence.

### 📝 Coding Standards

- **TypeScript**: We use strict TypeScript. Please define types for everything.
- **Linting**: We use ESLint and Prettier. Run `pnpm lint` to check for issues.
- **Commits**: Please write clear and descriptive commit messages.
  - Good: `Add support for PyPI proxy repositories`
  - Bad: `fix bug`

### 🚀 How to Propose Changes

1. Open an issue with the problem statement, use case, and expected behavior.
2. Include reproduction steps, logs, screenshots, or sample payloads when relevant.
3. If the request affects architecture or package flows, explain the operational impact.
4. The maintainer will decide whether the change belongs in `ravhub-core`.

### 🐛 Reporting Bugs

If you find a bug, please open an issue with:

- Steps to reproduce
- Expected behavior
- Actual behavior
- Logs or screenshots (if applicable)

---

<a name="español"></a>

## 🇪🇸 Contribuir a RavHub

¡Gracias por tu interés en RavHub! 🎉

`ravhub-core` es público y visible para la comunidad bajo AGPL, pero el código fuente lo mantiene el autor del proyecto. Por ese motivo, actualmente no se aceptan pull requests externos de código fuente.

Sí son bienvenidos:

- Reportes de bugs con pasos claros de reproducción
- Propuestas de funcionalidad y feedback de producto
- Discusiones de arquitectura
- Reportes y aclaraciones de documentación

Si quieres que algo entre en el core, abre un issue o una discusión y el mantenedor podrá implementarlo directamente.

El copyright de `ravhub-core` debe atribuirse al titular legal real del proyecto. Antes de ejecutar la herramienta de cabeceras del repositorio, configura `RAVHUB_COPYRIGHT_HOLDER` con el nombre legal exacto que deba aparecer en las cabeceras del código fuente.

### 🛠️ Configuración de Desarrollo

RavHub es un monorepo construido con:

- **Backend**: NestJS (Node.js)
- **Frontend**: React + Vite
- **Base de Datos**: PostgreSQL
- **Gestor de Paquetes**: pnpm

#### Requisitos Previos

- Node.js 22+
- Docker y Docker Compose
- pnpm (`npm install -g pnpm`)

#### Empezando

1. **Fork y Clonar**

   ```bash
   git clone https://github.com/tu-usuario/ravhub-core.git
   cd ravhub-core
   ```

2. **Instalar Dependencias**

   ```bash
   pnpm install
   ```

3. **Iniciar Entorno de Desarrollo**
   Esto iniciará PostgreSQL, Redis, API (modo watch) y Web (modo watch).

   ```bash
   docker compose -f docker-compose.dev.yml up --build
   ```

   - API: `http://localhost:3000`
   - Frontend: `http://localhost:5173`

### 🧪 Ejecutar Tests

Si vas a preparar un bug report, un caso de reproducción o una propuesta de documentación, verifica tu entorno e incluye la salida relevante de tests cuando sea posible.

#### Tests Unitarios

```bash
# Ejecutar tests de la API
pnpm --filter api test

# Ejecutar tests de Web
pnpm --filter web test
```

#### Tests E2E

```bash
# Asegúrate de que el stack esté corriendo primero
pnpm --filter api test:e2e
```

#### Suite Completa Automatizada

```bash
pnpm test:full
```

Este comando arranca el stack de desarrollo si hace falta, espera a que API y Web estén listos y después ejecuta de forma secuencial los tests unitarios de API, los tests unitarios de Web, los e2e de API, los Playwright del frontend y todos los escenarios shell E2E.

### 📝 Estándares de Código

- **TypeScript**: Usamos TypeScript estricto. Por favor define tipos para todo.
- **Linting**: Usamos ESLint y Prettier. Ejecuta `pnpm lint` para verificar problemas.
- **Commits**: Por favor escribe mensajes de commit claros y descriptivos.
  - Bien: `Añadir soporte para repositorios proxy de PyPI`
  - Mal: `arreglar bug`

### 🚀 Cómo Proponer Cambios

1. Abre un issue con el problema, caso de uso y comportamiento esperado.
2. Incluye pasos de reproducción, logs, capturas o payloads de ejemplo cuando aplique.
3. Si la propuesta afecta arquitectura o flujos de paquetes, explica el impacto operativo.
4. El mantenedor decidirá si el cambio debe formar parte de `ravhub-core`.

### 🐛 Reportar Bugs

Si encuentras un bug, por favor abre un issue con:

- Pasos para reproducir
- Comportamiento esperado
- Comportamiento actual
- Logs o capturas de pantalla (si aplica)

---

<div align="center">
  Gracias por construir el futuro de la gestión de paquetes con nosotros! 🚀
</div>
