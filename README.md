# RavHub (monorepo)

Proyecto para crear un gestor de repositorios de paquetes (hosted, proxy, group) con soporte inicial para Docker, npm y Maven.

Stack inicial propuesto:

- Frontend: React + Vite + TypeScript + MUI
- Backend: NestJS (modular, plugin-friendly)
- DB: PostgreSQL / MySQL
- Storage: filesystem local o S3/MinIO

Scripts principales:

- pnpm install / pnpm bootstrap
- pnpm dev (arranca api + web en desarrollo)

Adicionalmente se ha añadido soporte para ejecutar el entorno de desarrollo dentro de Docker (hot-reload):

- pnpm run dev:docker (arranca api + web en contenedores con hot-reload vía docker compose)

Próximos pasos:

1. Scaffold backend con NestJS (apps/api)
2. Scaffold frontend con Vite (apps/web)
3. Definir esquema DB para repositorios, roles y plugins

## Docker (desarrollo)

Para levantar los servicios de desarrollo dentro de contenedores con hot-reload:

```bash
# desde la raíz del repo
pnpm run dev:docker
# o directamente
docker compose -f docker-compose.dev.yml up --build
```

Esto construye e inicia los servicios `api` (NestJS) y `web` (Vite) en contenedores; el código fuente se monta en los contenedores para permitir hot-reloading.

Nota: docker-compose.dev.yml ahora carga variables desde `apps/api/.env` — copia `apps/api/.env.example` a `apps/api/.env` y ajústalo si necesitas valores distintos para desarrollo (con esto evitamos tocar las variables del host directamente).

Comandos útiles (pnpm)

```bash
# Levanta sólo el stack de desarrollo (api + web)
pnpm run compose:dev:up

# Baja sólo el stack de desarrollo y elimina volúmenes/recursos huérfanos
pnpm run compose:dev:down

# Levanta el license portal (servicios del portal de licencias)
pnpm run compose:license:up
pnpm run compose:license:down

# Levanta ambos (dev + license portal) — útil cuando el portal y la API se prueban juntos
pnpm run compose:both:up
pnpm run compose:both:down

# Ver servicios y logs de ambos stacks
pnpm run compose:ps
pnpm run compose:logs
```

## Base de datos y migraciones

Actualmente el entorno de desarrollo usa PostgreSQL (imagen `postgres:15-alpine`) como servicio en `docker-compose.dev.yml` — esto facilita la migración futura a Kubernetes + Helm (Postgres es una opción sólida y compatible con Helm charts comunes).

Cómo funciona en desarrollo:

- La API usa TypeORM; en `apps/api/src/app.module.ts` la conexión se configura por variables de entorno.
- En `docker-compose.dev.yml` la DB se expone en `postgres:5432` y la API en desarrollo usa `TYPEORM_SYNC=true` para crear el esquema automáticamente.

Notas para producción / siguiente pasos:

- No usar `synchronize` en producción (puede causar pérdida de datos). Usar migraciones gestionadas con `DataSource` (archivo `apps/api/src/data-source.ts`) y la CLI de TypeORM para generar/ejecutar migraciones.
- Cuando preparemos el chart de Helm, diseñaremos `values.yaml` para configurar base de datos, secretos y volúmenes.

Soporte actual añadido (migraciones + seeds):

- Archivo de DataSource para migraciones: `apps/api/src/data-source.ts` (usa `src/migrations/*.ts` en desarrollo y `dist/migrations/*.js` en producción).
- Scripts disponibles en `apps/api/package.json`:
  - `pnpm --filter api run migrations:create -n <Name>` — crea plantilla de migración (TypeORM CLI)
  - `pnpm --filter api run migrations:generate -n <Name>` — genera una migración (TypeORM CLI)
  - `pnpm --filter api run migrations:run` — aplica migraciones pendientes
  - `pnpm --filter api run migrations:revert` — revierte la última migración
  - `pnpm --filter api run db:seed` — aplica solo los seeds
  - `pnpm --filter api run db:setup` — ejecuta migraciones y luego aplica seeds (útil en setups de CI / contenedores)

Ejemplo (desde la raíz del repo) para aplicar migraciones y seeds contra el Postgres expuesto por docker-compose.dev:

```bash
# usa un fichero .env para no exportar variables en el host
# copia el ejemplo y edita si necesitas valores distintos:
cp apps/api/.env.example apps/api/.env

# luego ejecuta las tareas (ts-node cargará .env automáticamente)
pnpm --filter api run db:setup
```

## Running integration/e2e tests with compose

The repository includes a small helper script to run local integration tests with a set
of supporting services (Postgres, registry, verdaccio, pypi, etc.). The script picks
free host ports automatically to avoid colliding with locally running dev stacks:

```bash
./test/run-e2e-with-compose.sh
```

If you prefer running the compose file manually, note the test compose default binds the
API to host port 30000 (TEST_API_PORT defaults to 30000) to avoid collisions with dev
which uses 3000 by default.

---

## Seeds y datos por defecto

Se ha añadido un seed inicial que inserta los roles por defecto (`admin`, `reader`) y un repositorio de ejemplo (`example-npm`).
Nota importante: El seed ya no crea automáticamente un usuario administrador por defecto — esto aplica en todos los entornos (dev/test/prod). Para crear el primer superusuario use el endpoint `POST /auth/bootstrap` desde la UI o la API. Si por alguna razón necesita volver a crear el admin desde el seed (por ejemplo en CI), puede habilitarlo estableciendo la variable de entorno `SEED_CREATE_ADMIN=true` antes de ejecutar `db:seed`.

Además, el seed ahora preinstala un conjunto básico de repositorios Maven tanto en **development** como en **production** (hosted, proxy y group: `maven-hosted`, `maven-proxy`, `maven-group`). En entornos de **test** las pruebas crean recursos ad‑hoc (para evitar dependencias globales entre ejecuciones). Esto mantiene el entorno local de desarrollo listo para probar Maven mientras mantiene los tests autocontenidos.
El seed principal está en `apps/api/src/seeds/seed-defaults.ts` y se puede ejecutar con `db:seed` o a través de `db:setup`.

---

## Plugins (arquitectura inicial)

Se añadió una arquitectura simple para plugins en el backend:

- Definición de interfaz: `apps/api/src/plugins/plugin.interface.ts`.
- Loader del host: `apps/api/src/modules/plugins/plugins.service.ts` — descubre plugins en `apps/api/src/plugins` y los registra (opcionalmente en DB).
- Módulo de plugins: `apps/api/src/modules/plugins` con un endpoint exponiendo los plugins cargados `/plugins` y `/plugins/:key/ping`.
- Ejemplo de plugin: `apps/api/src/plugins/npm-plugin.ts` (plugin de ejemplo para npm).

Hot-deploy de plugins (despliegue en caliente):

- Coloca un archivo `zip` o `tar.gz` con la estructura del plugin en `apps/api/deploy` (esta carpeta se monta en el contenedor `api` en desarrollo). **Preferir artefactos compilados (JS) en vez de fuente TypeScript** para evitar que el compilador del `api` intente compilar archivos `.ts` adicionales y genere errores por dependencias no incluidas.
- El servicio `PluginDeploymentService` (registrado en `PluginsModule`) vigila la carpeta `apps/api/deploy`, descomprime el artefacto y lo mueve a `apps/api/src/plugins/<nombre>-plugin`.
- Si el plugin está bien formado, el `PluginsService` intentará recargar el plugin en caliente y (si corresponde) inicializarlo.
- Para empaquetar un plugin: incluya `index.ts` (o `index.js` en compilado), `package` subfolders, `proxy/`, `storage/`, `auth/` si aplica, y `icon.png`. El SDK `plugins-sdk` incluye plantillas para comenzar.

Nota: El soporte para `docker` ya se incluye por defecto en la aplicación (ver `apps/api/src/plugins/docker-plugin`). El SDK ya no incluye una plantilla `docker-plugin`.

SDK para plugins:

- Hemos añadido un paquete SDK en `packages/plugins-sdk` que contiene las interfaces y utilidades para el desarrollo de plugins y plantillas para scaffolding.
- Para generar un plugin nuevo desde una plantilla: `pnpm --filter @ravhub/plugins-sdk run scaffold -- my-plugin`.

Desarrollo rápido de plugins:

1. Crear un módulo en `apps/api/src/plugins/<plugin-name>.ts` que exporte por defecto un objeto que cumpla `IPlugin` (ver `plugin.interface.ts`).
2. Reiniciar la API en modo desarrollo; el loader intentará cargar automáticamente los plugins y los registrará en la tabla `plugins`.

---

## Helm chart (dev -> staging)

Se agregó un Chart básico en `charts/distributed-registry/` que despliega `api`, `web` y `postgres`.

Uso local (helm instalado y cluster listo):

```bash
# ejemplo para desplegar con valores de desarrollo
helm install my-registry charts/distributed-registry -f charts/distributed-registry/values.yaml

# para staging (usa placeholders en values-staging.yaml):
helm upgrade --install my-registry charts/distributed-registry -f charts/distributed-registry/values-staging.yaml
```

Este chart es minimalista y pensado como punto de partida — ajustaremos recursos, probes, CRDs y secretos cuando pasemos al flujo CI/CD y a despliegues reales en k8s.
