<div align="center">

# Contributing to RavHub / Contribuir a RavHub

[English](#english) | [Español](#español)

</div>

---

<a name="english"></a>

## 🇬🇧 Contributing to RavHub

First of all, thank you for your interest in contributing to RavHub! 🎉
We welcome contributions from everyone. Whether you're fixing a bug, improving documentation, or proposing a new feature, your help is appreciated.

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

Before submitting a PR, please ensure all tests pass.

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

### 📝 Coding Standards

- **TypeScript**: We use strict TypeScript. Please define types for everything.
- **Linting**: We use ESLint and Prettier. Run `pnpm lint` to check for issues.
- **Commits**: Please write clear and descriptive commit messages.
  - Good: `Add support for PyPI proxy repositories`
  - Bad: `fix bug`

### 🚀 Submitting a Pull Request

1. Create a new branch: `git checkout -b feat/my-feature`
2. Make your changes and commit them.
3. Push to your fork: `git push origin feat/my-feature`
4. Open a Pull Request in the main repository.
5. Describe your changes clearly and link any related issues.

### 🐛 Reporting Bugs

If you find a bug, please open an issue with:

- Steps to reproduce
- Expected behavior
- Actual behavior
- Logs or screenshots (if applicable)

---

<a name="español"></a>

## 🇪🇸 Contribuir a RavHub

¡Gracias por tu interés en contribuir a RavHub! 🎉
Aceptamos contribuciones de todo el mundo. Ya sea arreglando un bug, mejorando la documentación o proponiendo una nueva característica, tu ayuda es bienvenida.

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

Antes de enviar un PR, asegúrate de que todos los tests pasen.

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

### 📝 Estándares de Código

- **TypeScript**: Usamos TypeScript estricto. Por favor define tipos para todo.
- **Linting**: Usamos ESLint y Prettier. Ejecuta `pnpm lint` para verificar problemas.
- **Commits**: Por favor escribe mensajes de commit claros y descriptivos.
  - Bien: `Añadir soporte para repositorios proxy de PyPI`
  - Mal: `arreglar bug`

### 🚀 Enviar un Pull Request

1. Crea una nueva rama: `git checkout -b feat/mi-feature`
2. Haz tus cambios y haz commit.
3. Push a tu fork: `git push origin feat/mi-feature`
4. Abre un Pull Request en el repositorio principal.
5. Describe tus cambios claramente y enlaza cualquier issue relacionado.

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
