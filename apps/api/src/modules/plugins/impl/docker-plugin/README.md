# Docker Plugin - Modular Architecture

Este plugin implementa un registro Docker compatible con la API Registry V2, con soporte para repositorios hosted, proxy y group.

## Estructura Modular

El plugin ha sido refactorizado desde un archivo monolítico de 2557 líneas a una arquitectura modular organizada en directorios lógicos:

```
docker-plugin/
├── index.ts                    # Punto de entrada principal (260 líneas)
├── docker-plugin.ts            # Archivo original (preservado, 2613 líneas)
│
├── config/                     # Configuración UI
│   └── schema.ts              # JSON Schema para el formulario (214 líneas)
│
├── auth/                       # Autenticación del plugin
│   └── auth.ts                # issueToken, authenticate, generateToken (36 líneas)
│
├── utils/                      # Utilidades compartidas
│   ├── helpers.ts             # normalizeImageName, uploads Map (55 líneas)
│   └── types.ts               # Interfaces TypeScript (121 líneas)
│
├── storage/                    # Operaciones de almacenamiento
│   ├── upload.ts              # Iniciar/añadir/finalizar uploads de blobs (234 líneas)
│   ├── download.ts            # Descargar manifests y blobs (262 líneas)
│   └── manifest.ts            # PUT/DELETE manifests (326 líneas)
│
├── proxy/                      # Fetching de registros upstream
│   └── fetch.ts               # proxyFetch con caching e indexación (295 líneas)
│
├── packages/                   # Listado y metadata de paquetes
│   └── list.ts                # listPackages, getPackage, listVersions (295 líneas)
│
└── registry/                   # Servidor HTTP del registro
    ├── port-manager.ts        # Selección y validación de puertos (71 líneas)
    ├── auth.ts                # Validación JWT y Basic auth (95 líneas)
    ├── utils.ts               # Helpers HTTP (readBody, sendAuthChallenge) (48 líneas)
    └── server.ts              # Servidor HTTP completo (962 líneas)
```

**Total:** 5887 líneas organizadas en 15 módulos

## Módulos Principales

### 1. **index.ts** - Punto de Entrada

- Importa todos los módulos
- Inicializa dependencias via `init()` functions
- Crea el objeto plugin unificado
- Mantiene compatibilidad con la interfaz original
- Exporta todas las APIs públicas

### 2. **config/schema.ts**

- JSON Schema completo para renderizado de UI
- Condicionales `allOf` para tipos hosted/proxy/group
- Configuración de upstream, auth, miembros de grupo

### 3. **auth/auth.ts**

- `issueToken()`: Genera tokens JWT para autenticación
- `authenticate()`: Valida credenciales de usuarios
- `generateToken()`: Crea tokens con scopes específicos

### 4. **utils/**

- `helpers.ts`: `normalizeImageName()`, Maps compartidos (uploads, uploadTargets)
- `types.ts`: Interfaces TypeScript (Repository, PluginContext, DockerConfig, etc.)

### 5. **storage/**

- `upload.ts`: Manejo de uploads multipart de blobs con routing a grupos
- `download.ts`: Descarga de manifests/blobs con revalidación de proxy
- `manifest.ts`: PUT manifests (valida refs, fetch desde upstream), DELETE operations

### 6. **proxy/fetch.ts**

- Fetching de registros upstream con autenticación
- Caching inteligente
- Indexación automática de artefactos
- Manejo de streams grandes
- Retry logic con decodificación de paths
- Retry logic con decodificación de paths
- `pingUpstream(repo)`: comprobación de reachability al upstream/proxy (ping)

### 7. **packages/list.ts**

- `listPackages()`: Lista todos los paquetes con agregación de grupos
- `getPackage()`: Obtiene metadata de un paquete específico
- `listVersions()`: Lista tags/versiones disponibles
- `getInstallCommand()`: Genera comando `docker pull`

### 8. **registry/** - Servidor HTTP

#### registry/port-manager.ts

- `selectPort()`: Auto-selección de puerto libre (rango 5000-5100) o validación de puerto específico
- `isPortAvailable()`: Verifica disponibilidad usando `net.createServer()`

#### registry/auth.ts

- `checkTokenAllows()`: Valida JWT Bearer tokens y Basic auth
- Shortcuts para usuarios de test (admin, test-user)
- Verificación de scopes para acciones push/pull

#### registry/utils.ts

- `readBody()`: Lee el body completo de un request HTTP
- `sendAuthChallenge()`: Envía respuesta 401/403 con WWW-Authenticate header

#### registry/server.ts

- `startRegistryForRepo()`: Inicia servidor HTTP para un repositorio
- `stopRegistryForRepo()`: Detiene servidor HTTP
- Implementa endpoints Docker Registry V2:
  - `GET /v2/` - Ping con challenge de autenticación
  - `GET /v2/token` - Proxy a API principal
  - `GET /v2/<name>/tags/list` - Lista de tags
  - `POST /v2/<name>/blobs/uploads/` - Iniciar upload
  - `PATCH /v2/<name>/blobs/uploads/<uuid>` - Añadir a upload
  - `PUT /v2/<name>/blobs/uploads/<uuid>?digest=` - Finalizar upload
  - `GET /v2/<name>/manifests/<ref>` - Obtener manifest
  - `PUT /v2/<name>/manifests/<ref>` - Subir manifest
  - `GET /v2/<name>/blobs/<digest>` - Descargar blob
- Soporte para Range headers (partial downloads)
- Resolución de grupos (itera sobre miembros)
- Tracking de descargas para analytics

## Patrón de Inicialización

Cada módulo sigue el patrón de inyección de dependencias:

```typescript
// En el módulo
let storage: StorageAdapter;
let getRepo: (id: string) => Promise<Repository | null>;

export function initModule(context: {
  storage: StorageAdapter;
  getRepo: Function;
}) {
  storage = context.storage;
  getRepo = context.getRepo;
}

export async function someFunction(repo: Repository, args: any) {
  // Usa storage y getRepo...
}
```

```typescript
// En index.ts
import { initModule, someFunction } from './module';

export function createDockerPlugin(context: PluginContext) {
  initModule({ storage: context.storage, getRepo });

  return {
    someFunction,
    // ... otros métodos
  };
}
```

## Beneficios de la Modularización

1. **Mantenibilidad**: Archivos pequeños (~200-300 líneas) fáciles de entender
2. **Reusabilidad**: Módulos pueden reutilizarse en otros plugins (nuget, composer, maven)
3. **Testabilidad**: Cada módulo puede testearse de forma independiente
4. **Separación de Concerns**: Cada directorio tiene una responsabilidad clara
5. **Escalabilidad**: Fácil añadir nuevas features sin modificar todo el plugin
6. **Colaboración**: Múltiples desarrolladores pueden trabajar en paralelo

## Uso

### Desde Plugin Manager

```typescript
import { createDockerPlugin } from './plugins/docker-plugin';

const plugin = createDockerPlugin({
  storage: storageAdapter,
  // ... otras dependencias
});

// Usar el plugin
await plugin.listPackages(repository);
await plugin.startRegistryForRepo(repository, { port: 5000 });
```

### Import Directo de Módulos

```typescript
// Importar módulos específicos
import { normalizeImageName } from './plugins/docker-plugin/utils/helpers';
import { proxyFetch } from './plugins/docker-plugin/proxy/fetch';

// Usar directamente
const normalized = normalizeImageName('library/nginx');
```

## Compatibilidad

El archivo original `docker-plugin.ts` se mantiene intacto para:

- Referencia durante la migración
- Rollback en caso de problemas
- Comparación de comportamiento

Una vez validada la nueva arquitectura, puede eliminarse.

## Próximos Pasos

1. **Testing**: Crear tests unitarios para cada módulo
2. **Migración**: Actualizar referencias a usar `index.ts` en lugar de `docker-plugin.ts`
3. **Plugins Similares**: Usar esta estructura como template para nuget, composer, maven
4. **Documentación API**: Generar docs con TypeDoc
5. **Monitor upstream reachability**: El plugin ahora expone `pingUpstream(repo)` y el sistema realiza comprobaciones periódicas para repositorios `type: 'proxy'`.

- Intervalo configurable via env `UPSTREAM_PING_INTERVAL_SECONDS` (default 300s)
- Los resultados se almacenan en memoria y se exponen en la API `Repository` DTO como `upstreamStatus` ({ ok, status, message, ts }) para que la UI muestre el estado en `RepoCard`.

5. **Performance**: Profiling y optimizaciones específicas por módulo

## Commits

La refactorización se realizó en 4 commits incrementales:

1. `feat(docker-plugin): extract config, auth, proxy, and upload modules`
2. `feat(docker-plugin): extract packages module`
3. `feat(docker-plugin): extract storage download and manifest modules`
4. `feat(docker-plugin): extract registry server modules and create main index`

Cada commit es funcional e incremental para facilitar rollback.
