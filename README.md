<div align="center">

<img src="apps/web/public/logo.png" alt="RavHub Logo" width="200"/>

# 📦 RavHub

### Self-Hosted Package Registry for Modern Teams

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

**A powerful, cloud-native alternative to JFrog Artifactory and Sonatype Nexus.**

[English](#english) | [Español](#español)

</div>

---

<a name="english"></a>

## 🚀 What is RavHub?

RavHub is a **self-hosted package registry** that allows you to host, proxy, and manage software packages across multiple ecosystems. Deploy it on your own infrastructure and take full control of your artifacts.

### ✨ Key Features

| Feature                    | Description                                      | Status  |
| -------------------------- | ------------------------------------------------ | :-----: |
| 📦 **NPM Registry**        | Host private npm packages or proxy npmjs.com     |   ✅    |
| ☕ **Maven Repository**    | Manage Java/Kotlin artifacts with Maven/Gradle   |   ✅    |
| 🐍 **PyPI Repository**     | Host Python packages or proxy pypi.org           |   ✅    |
| 🔷 **NuGet Repository**    | .NET package management                          |   ✅    |
| 🎼 **Composer Repository** | PHP packages for your Laravel/Symfony projects   |   ✅    |
| 🦀 **Cargo Registry**      | Rust crates management                           |   ✅    |
| 📁 **Raw Repository**      | Store any binary artifacts                       |   ✅    |
| � **Docker Registry**      | Full OCI-compliant registry for container images | 🚧 Soon |
| ⚓ **Helm Charts**         | Kubernetes Helm chart repository                 | 🚧 Soon |

### 🏗️ Repository Types

- **Hosted**: Store your private packages
- **Proxy**: Cache packages from upstream registries (npm, Docker Hub, Maven Central...)
- **Group**: Combine multiple repositories into a single endpoint

---

## � Quick Start

### Using Helm (Coming Soon 🚧)

_Once the public chart repository is live:_

```bash
# Add the RavHub Helm repository
helm repo add ravhub https://charts.ravhub.app
helm repo update

# Install RavHub
helm install ravhub ravhub/ravhub \
  --namespace ravhub \
  --create-namespace \
  --set ingress.enabled=true \
  --set ingress.host=ravhub.example.com
```

### Using Docker (Coming Soon 🚧)

_Once the official image is published:_

```bash
# Start the stack
docker compose -f docker-compose.prod.yml up -d

# Access the UI at http://localhost
```

### First-Time Setup

1. Open your RavHub URL in the browser
2. Create the first admin user via `/auth/bootstrap`
3. Start creating repositories!

---

## 📖 Usage Examples

### Docker

```bash
# Login to your registry
docker login localhost:5000 -u admin

# Push an image
docker tag myapp:latest localhost:5000/myapp:latest
docker push localhost:5000/myapp:latest

# Pull an image
docker pull localhost:5000/myapp:latest
```

### NPM

```bash
# Configure npm to use your registry
npm config set registry http://localhost/repository/npm-hosted/

# Publish a package
npm publish

# Install from your registry
npm install my-private-package
```

### Maven

```xml
<!-- Add to your pom.xml -->
<repositories>
    <repository>
        <id>ravhub</id>
        <url>http://localhost/repository/maven-group/</url>
    </repository>
</repositories>
```

### Python/pip

```bash
# Install from your PyPI proxy
pip install requests --index-url http://localhost/repository/pypi-proxy/simple/

# Upload with twine
twine upload --repository-url http://localhost/repository/pypi-hosted/ dist/*
```

---

## 🛠️ Development Setup

### Prerequisites

- Node.js 22+
- pnpm 9+
- Docker & Docker Compose
- PostgreSQL 15+ (or use the included Docker service)

### Local Development

```bash
# Install dependencies
pnpm install

# Start development stack (API + Web + PostgreSQL)
docker compose -f docker-compose.dev.yml up --build

# API: http://localhost:3000
# Web: http://localhost:5173
```

### Running Tests

```bash
# Unit tests
pnpm --filter api test

# E2E tests
pnpm --filter api test:e2e
```

---

## 🏛️ Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          RavHub Container (All-in-One)                     │
│                                                                            │
│    ┌───────────────────────────┐              ┌────────────────────────┐   │
│    │      Nginx (Port 80)      │              │   Docker (Port 5000)   │   │
│    │      (Reverse Proxy)      │              │      (Direct API)      │   │
│    └─────────────┬─────────────┘              └───────────┬────────────┘   │
│                  │                                        │                │
│        ┌─────────┴─────────┐                              │                │
│        ▼                   ▼                              │                │
│  ┌────────────┐     ┌─────────────┐                       │                │
│  │  Static    │     │     API     │◄──────────────────────┘                │
│  │  Assets    │     │   (NestJS)  │                                        │
│  └────────────┘     └──────┬──────┘                                        │
└────────────────────────────┼───────────────────────────────────────────────┘
                             │
             ┌───────────────┼───────────────┐
             │               │               │
             ▼               ▼               ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │  PostgreSQL  │ │    Storage   │ │     Redis    │
     │    (Data)    │ │  (Artifacts) │ │   (Optional) │
     └──────────────┘ └──────────────┘ └──────────────┘
```

---

## 🔒 Security

- **Authentication**: Basic Auth with JWT tokens
- **Authorization**: Role-based access control (RBAC)
- **Repository Permissions**: Granular per-repository access control
- **Audit Logging**: Track all actions for compliance

---

## 📊 Community vs Enterprise

| Feature              | Community | Enterprise |
| -------------------- | :-------: | :--------: |
| All Package Managers |    ✅     |     ✅     |
| Hosted/Proxy/Group   |    ✅     |     ✅     |
| RBAC & Permissions   |    ✅     |     ✅     |
| Filesystem Storage   |    ✅     |     ✅     |
| S3/GCS/Azure Storage |    ❌     |     ✅     |
| Scheduled Backups    |    ❌     |     ✅     |
| Cleanup Policies     |    ✅     |     ✅     |
| Audit Logging        |    ✅     |     ✅     |

---

## 🤝 Contributing

RavHub Core is public and community-visible, but the source code is maintained by the project author.

- Issues, bug reports, reproduction cases, documentation reports, and product feedback are welcome.
- Source code pull requests are not currently accepted for `ravhub-core`.
- If you want a feature in core, open an issue or discussion and the maintainer may implement it directly.

Read the [Contributing Guide](CONTRIBUTING.md) before opening issues or proposing changes.

---

## 📄 License

This project is licensed under the GNU Affero General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

`ravhub-core` is the public AGPL community edition. Proprietary enterprise functionality is licensed and distributed separately and is not included in this repository.

---

<a name="español"></a>

# 📦 RavHub (Español)

### Registro de Paquetes Self-Hosted para Equipos Modernos

---

## 🚀 ¿Qué es RavHub?

RavHub es un **registro de paquetes self-hosted** que te permite alojar, hacer proxy y gestionar paquetes de software en múltiples ecosistemas. Despliégalo en tu propia infraestructura y toma el control total de tus artefactos.

### ✨ Características Principales

| Característica              | Descripción                                               |     Estado      |
| --------------------------- | --------------------------------------------------------- | :-------------: |
| 📦 **Registro NPM**         | Aloja paquetes npm privados o haz proxy de npmjs.com      |       ✅        |
| ☕ **Repositorio Maven**    | Gestiona artefactos Java/Kotlin con Maven/Gradle          |       ✅        |
| 🐍 **Repositorio PyPI**     | Aloja paquetes Python o haz proxy de pypi.org             |       ✅        |
| 🔷 **Repositorio NuGet**    | Gestión de paquetes .NET                                  |       ✅        |
| 🎼 **Repositorio Composer** | Paquetes PHP para tus proyectos Laravel/Symfony           |       ✅        |
| 🦀 **Registro Cargo**       | Gestión de crates de Rust                                 |       ✅        |
| 📁 **Repositorio Raw**      | Almacena cualquier artefacto binario                      |       ✅        |
| 🐳 **Registro Docker**      | Registro compatible con OCI para imágenes de contenedores | 🚧 Próximamente |
| ⚓ **Charts de Helm**       | Repositorio de charts Helm para Kubernetes                | 🚧 Próximamente |

### 🏗️ Tipos de Repositorio

- **Hosted**: Almacena tus paquetes privados
- **Proxy**: Cachea paquetes de registros upstream (npm, Docker Hub, Maven Central...)
- **Group**: Combina múltiples repositorios en un único endpoint

---

## � Inicio Rápido

### Usando Helm (Recomendado)

```bash
# Añade el repositorio Helm de RavHub
helm repo add ravhub https://charts.ravhub.app
helm repo update

# Instala RavHub
helm install ravhub ravhub/ravhub \
  --namespace ravhub \
  --create-namespace \
  --set ingress.enabled=true \
  --set ingress.host=ravhub.mi-empresa.com

# O instala desde el chart local
helm install ravhub ./charts/ravhub -n ravhub --create-namespace
```

### Usando Docker Compose (Desarrollo/Pruebas)

```bash
# Clona el repositorio
git clone https://github.com/your-org/ravhub-core.git
cd ravhub-core

# Inicia el stack
docker compose -f docker-compose.prod.yml up -d

# Accede a la UI en http://localhost
```

### Primera Configuración

1. Abre `http://localhost` en tu navegador
2. Crea el primer usuario admin vía `/auth/bootstrap`
3. ¡Empieza a crear repositorios!

---

## 🛠️ Desarrollo Local

### Requisitos Previos

- Node.js 22+
- pnpm 9+
- Docker & Docker Compose
- PostgreSQL 15+ (o usa el servicio Docker incluido)

### Desarrollo

```bash
# Instala dependencias
pnpm install

# Inicia el stack de desarrollo (API + Web + PostgreSQL)
docker compose -f docker-compose.dev.yml up --build

# API: http://localhost:3000
# Web: http://localhost:5173
```

### Ejecutar Tests

```bash
# Tests unitarios
pnpm --filter api test

# Tests E2E
pnpm --filter api test:e2e
```

---

## 📊 Community vs Enterprise

| Característica              | Community | Enterprise |
| --------------------------- | :-------: | :--------: |
| Todos los Package Managers  |    ✅     |     ✅     |
| Hosted/Proxy/Group          |    ✅     |     ✅     |
| RBAC y Permisos             |    ✅     |     ✅     |
| Almacenamiento Filesystem   |    ✅     |     ✅     |
| Políticas de Limpieza       |    ✅     |     ✅     |
| Almacenamiento S3/GCS/Azure |    ❌     |     ✅     |
| Backups Programados         |    ❌     |     ✅     |
| Registro de Auditoría       |    ✅     |     ✅     |

---

## 🤝 Contribuir

RavHub Core es público y visible para la comunidad, pero el código fuente lo mantiene el autor del proyecto.

- Son bienvenidos los issues, reportes de bugs, casos de reproducción, observaciones sobre documentación y feedback de producto.
- Actualmente no se aceptan pull requests de código fuente para `ravhub-core`.
- Si quieres una funcionalidad en el core, abre un issue o una discusión y el mantenedor podrá implementarla directamente.

Lee la [Guía de Contribución](CONTRIBUTING.md) antes de abrir un issue o proponer un cambio.

---

## 📄 Licencia

Este proyecto está licenciado bajo la Licencia GNU Affero General Public License v3.0 - ver el archivo [LICENSE](LICENSE) para más detalles.

`ravhub-core` es la edición pública comunitaria bajo AGPL. La funcionalidad enterprise propietaria se licencia y distribuye por separado y no forma parte de este repositorio.

---

<div align="center">

**Maintained by the project author**

[⬆ Back to top](#-ravhub)

</div>
