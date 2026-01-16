# Sistema de Permisos Unificado

## Resumen

El sistema de permisos implementa un **modelo jerárquico** de tres niveles que combina control global con granularidad por repositorio:

1. **Superadmin/Admin** → Acceso completo a todos los recursos
2. **Permisos Globales** → Acceso a todos los repositorios (`repo.read`, `repo.write`, `repo.manage`)
3. **Permisos Específicos** → Acceso granular por repositorio (`read`, `write`, `admin`)

**Precedencia**: Los niveles superiores **sobrescriben** los inferiores. Un superadmin siempre tiene acceso completo independientemente de permisos granulares.

---

## Arquitectura

### Backend Components

#### 1. `UnifiedPermissionGuard`

**Ubicación**: `apps/api/src/modules/rbac/unified-permission.guard.ts`

Guard unificado que reemplaza la combinación de `PermissionsGuard` + `RepositoryPermissionGuard`.

**Decoradores soportados**:

- `@Permissions('repo.read')` - Requiere permiso global
- `@RepositoryPermission('read')` - Requiere permiso en repositorio específico
- Ambos pueden combinarse en un mismo endpoint

**Lógica de validación**:

```typescript
1. ¿Es superadmin/admin? → ✅ Permitir
2. ¿Tiene permiso global? → ✅ Permitir
3. ¿Tiene permiso en repositorio específico? → ✅ Permitir
4. Ninguna anterior → ❌ Denegar (403 Forbidden)
```

**Uso en controllers**:

```typescript
@Get(':id')
@UseGuards(UnifiedPermissionGuard)
@Permissions('repo.read')              // Requiere permiso global O
@RepositoryPermission('read')          // permiso específico en el repo
async getRepository(@Param('id') id: string) {
  // ...
}
```

#### 2. `PermissionService`

**Ubicación**: `apps/api/src/modules/rbac/permission.service.ts`

Servicio centralizado para todas las operaciones de permisos.

**Métodos principales**:

```typescript
// Verificación booleana simple
async hasPermission(
  userId: string,
  requiredPermission: string,
  repositoryId?: string
): Promise<boolean>

// Verificación detallada con contexto
async checkPermission(
  userId: string,
  requiredPermission: string,
  repositoryId?: string
): Promise<PermissionCheckResult>
// Returns: { granted: boolean, level: 'superadmin'|'global'|'repository'|'none', permission?: string }

// Obtener nivel de permiso efectivo de un usuario en un repositorio
async getUserRepositoryPermission(
  userId: string,
  repositoryId: string
): Promise<'read' | 'write' | 'admin' | null>
```

**Ejemplo de uso**:

```typescript
// En un controller
const result = await this.permissionService.checkPermission(
  user.id,
  "repo.write",
  repositoryId
);

if (!result.granted) {
  throw new ForbiddenException("Insufficient permissions");
}

console.log(`Access granted via ${result.level} level`);
```

#### 3. `RepositoryPermissionService`

**Ubicación**: `apps/api/src/modules/repos/repository-permission.service.ts`

Servicio para gestionar permisos granulares CRUD.

**Operaciones**:

```typescript
// Otorgar permisos
await repoPermService.grantUserPermission(repoId, userId, "write");
await repoPermService.grantRolePermission(repoId, roleId, "admin");

// Revocar permisos
await repoPermService.revokePermission(permissionId);

// Consultar permisos
const perms = await repoPermService.getRepositoryPermissions(repoId);
const hasAccess = await repoPermService.hasPermission(userId, repoId, "read");
```

---

## Jerarquía de Permisos Detallada

### Nivel 1: Superadmin/Admin

**Roles**: `superadmin`, `admin`  
**Permiso equivalente**: `*` (wildcard)

✅ **Acceso completo** a:

- Todos los repositorios (CRUD completo)
- Gestión de usuarios y roles
- Configuración del sistema
- Todos los endpoints sin restricción

**Prioridad**: Máxima. Ignora permisos globales y granulares.

**Ejemplo**:

```typescript
User {
  id: "uuid",
  roles: [{ name: "superadmin" }],
  permissions: []  // No necesita permisos explícitos
}
// → Puede hacer CUALQUIER operación
```

---

### Nivel 2: Permisos Globales

Permisos que aplican a **TODOS los repositorios** del sistema.

| Permiso       | Descripción               | Permite                                             |
| ------------- | ------------------------- | --------------------------------------------------- |
| `repo.read`   | Lectura de repositorios   | Listar, ver metadatos, descargar paquetes           |
| `repo.write`  | Escritura en repositorios | Subir paquetes, actualizar configuración            |
| `repo.manage` | Administración completa   | Crear/eliminar repos, gestionar permisos granulares |

**Jerarquía interna**: `repo.manage` > `repo.write` > `repo.read`

- Quien tiene `repo.manage` puede hacer operaciones de `write` y `read`
- Quien tiene `repo.write` puede hacer operaciones de `read`

**Uso típico**:

- **DevOps teams**: `repo.read` para monitoreo
- **CI/CD systems**: `repo.write` para publicar artefactos
- **Platform admins**: `repo.manage` para gestión completa

**Ejemplo**:

```typescript
User {
  id: "uuid",
  roles: [{
    name: "developer",
    permissions: [{ key: "repo.write" }]
  }]
}
// → Puede leer Y escribir en CUALQUIER repositorio
```

---

### Nivel 3: Permisos Granulares (Por Repositorio)

Permisos asignados a nivel de **repositorio individual**.

| Permiso | Valor | Descripción                                                  |
| ------- | ----- | ------------------------------------------------------------ |
| `read`  | 1     | Lectura del repositorio específico                           |
| `write` | 2     | Escritura en el repositorio específico                       |
| `admin` | 3     | Administración del repositorio (incluye gestión de permisos) |

**Tabla**: `repository_permissions`

```sql
CREATE TABLE repository_permissions (
  id UUID PRIMARY KEY,
  repository_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission VARCHAR(10) CHECK (permission IN ('read', 'write', 'admin')),
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT check_user_or_role CHECK (
    (user_id IS NOT NULL AND role_id IS NULL) OR
    (user_id IS NULL AND role_id IS NOT NULL)
  )
);
```

**Asignación**:

- **Por usuario**: Permiso directo a usuario específico
- **Por rol**: Permiso heredado de rol (escalable)

**Uso típico**:

- Equipos con acceso limitado a repos específicos
- Usuarios externos con acceso solo a ciertos artefactos
- Repositorios sensibles con control estricto

**Ejemplo**:

```typescript
// Usuario "contractor" solo tiene acceso al repo "client-project"
RepositoryPermission {
  repository_id: "client-project-uuid",
  user_id: "contractor-uuid",
  permission: "read"
}
// → Solo puede leer "client-project", no otros repos
```

---

## Flujo de Autorización

### Diagrama de Decisión

```
┌─────────────────────┐
│ Request Incoming    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────┐
│ ¿Usuario autenticado?       │
│ (JWT válido en req.user)    │
└──────────┬──────────────────┘
           │ No → 401 Unauthorized
           │ Sí
           ▼
┌─────────────────────────────┐
│ NIVEL 1: ¿Superadmin/Admin? │
│ roles: [superadmin, admin]  │
│ permissions: [*]            │
└──────────┬──────────────────┘
           │ Sí → ✅ PERMITIR
           │ No
           ▼
┌─────────────────────────────┐
│ NIVEL 2: ¿Permiso global?   │
│ @Permissions('repo.write')  │
└──────────┬──────────────────┘
           │ Sí → ✅ PERMITIR
           │ No
           ▼
┌─────────────────────────────┐
│ NIVEL 3: ¿Permiso granular? │
│ @RepositoryPermission('w.') │
│ en repository_permissions   │
└──────────┬──────────────────┘
           │ Sí → ✅ PERMITIR
           │ No
           ▼
      ❌ 403 Forbidden
```

---

## Ejemplos de Escenarios

### Escenario 1: Superadmin accede a cualquier repo

```typescript
// Usuario
const user = {
  id: "admin-uuid",
  roles: ["superadmin"],
  permissions: [],
};

// Request: DELETE /repository/sensitive-repo
// Decoradores: @Permissions('repo.manage') @RepositoryPermission('admin')

// ✅ NIVEL 1: Es superadmin → Acceso completo
// Backend permite eliminar el repositorio
```

---

### Escenario 2: Developer con permiso global escribe en varios repos

```typescript
// Usuario
const user = {
  id: "dev-uuid",
  roles: ["developer"],
  permissions: ["repo.write"], // Permiso global
};

// Request: POST /repository/backend/upload
// Decoradores: @Permissions('repo.write') @RepositoryPermission('write')

// ❌ NIVEL 1: No es superadmin
// ✅ NIVEL 2: Tiene repo.write global → Permitir
// (No necesita verificar nivel 3)
```

---

### Escenario 3: Contractor con acceso limitado

```typescript
// Usuario
const user = {
  id: "contractor-uuid",
  roles: ["guest"],
  permissions: [], // Sin permisos globales
};

// Permiso granular en BD:
// { repository_id: "client-app-uuid", user_id: "contractor-uuid", permission: "read" }

// Request 1: GET /repository/client-app
// ❌ NIVEL 1: No es admin
// ❌ NIVEL 2: No tiene repo.read global
// ✅ NIVEL 3: Tiene 'read' en ese repo específico → Permitir

// Request 2: GET /repository/internal-tools
// ❌ NIVEL 1: No es admin
// ❌ NIVEL 2: No tiene repo.read global
// ❌ NIVEL 3: No tiene permiso granular en internal-tools
// → 403 Forbidden
```

---

### Escenario 4: Team Lead con permisos mixtos

```typescript
// Usuario
const user = {
  id: "lead-uuid",
  roles: ["team-lead"],
  permissions: ["repo.read"], // Puede leer todos los repos
};

// Permiso granular:
// { repository_id: "team-project-uuid", user_id: "lead-uuid", permission: "admin" }

// Request 1: GET /repository/other-team-repo
// ✅ NIVEL 2: repo.read global → Puede leer cualquier repo

// Request 2: POST /repository/team-project/upload
// ❌ NIVEL 2: repo.read no cubre 'write'
// ✅ NIVEL 3: Tiene 'admin' en team-project (admin >= write) → Permitir

// Request 3: POST /repository/other-team-repo/upload
// ❌ NIVEL 2: repo.read no cubre 'write'
// ❌ NIVEL 3: No tiene permiso granular en other-team-repo
// → 403 Forbidden
```

---

## API de Gestión de Permisos

### Endpoints de Repository Permissions

#### Listar permisos de un repositorio

```http
GET /repository/:id/permissions
Authorization: Bearer <token>
```

**Response**:

```json
[
  {
    "id": "perm-uuid",
    "repositoryId": "repo-uuid",
    "userId": "user-uuid",
    "user": { "id": "user-uuid", "username": "john" },
    "permission": "write",
    "createdAt": "2025-12-06T10:00:00Z"
  },
  {
    "id": "perm-uuid-2",
    "repositoryId": "repo-uuid",
    "roleId": "role-uuid",
    "role": { "id": "role-uuid", "name": "developers" },
    "permission": "read",
    "createdAt": "2025-12-05T14:30:00Z"
  }
]
```

#### Otorgar permiso a usuario

```http
POST /repository/:id/permissions/user
Authorization: Bearer <token>
Content-Type: application/json

{
  "userId": "user-uuid",
  "permission": "write"
}
```

#### Otorgar permiso a rol

```http
POST /repository/:id/permissions/role
Authorization: Bearer <token>
Content-Type: application/json

{
  "roleId": "role-uuid",
  "permission": "read"
}
```

#### Revocar permiso

```http
DELETE /repository/:id/permissions/:permissionId
Authorization: Bearer <token>
```

---

## Frontend Integration

### Uso de `repo.userPermission`

El backend **pre-calcula** el nivel efectivo de permiso para cada repositorio y lo incluye en `repo.userPermission`:

```typescript
// Response de GET /repository
[
  {
    id: "repo-1",
    name: "backend",
    userPermission: "admin", // ← Calculado por backend (jerarquía completa)
  },
  {
    id: "repo-2",
    name: "frontend",
    userPermission: "read",
  },
  {
    id: "repo-3",
    name: "restricted",
    userPermission: null, // Usuario no tiene acceso
  },
];
```

### Helper Functions

**Ubicación**: `apps/web/src/components/Repos/repo-permissions.ts`

```typescript
import { canPerformOnRepo } from "./repo-permissions";

// En componentes
const repo = { id: "repo-1", name: "backend", userPermission: "write" };

// Verificaciones
canPerformOnRepo(user, repo, "read"); // ✅ true (write >= read)
canPerformOnRepo(user, repo, "write"); // ✅ true
canPerformOnRepo(user, repo, "admin"); // ❌ false (write < admin)
```

**Ventaja**: Frontend no necesita lógica compleja de jerarquías, solo compara niveles numéricos.

---

## Migración desde Sistema Dual

### Antes (Sistema Dual)

```typescript
// Dos guards separados
@UseGuards(PermissionsGuard, RepositoryPermissionGuard)
@Permissions('repo.write')
@RepositoryPermission('write')

// Lógica duplicada en ambos guards
// Frontend replicaba lógica de backend
```

### Después (Sistema Unificado)

```typescript
// Un solo guard con toda la lógica
@UseGuards(UnifiedPermissionGuard)
@Permissions('repo.write')
@RepositoryPermission('write')

// Backend calcula todo, frontend consume resultado
```

### Pasos de Migración

1. ✅ Crear `UnifiedPermissionGuard` y `PermissionService`
2. ✅ Actualizar `RbacModule` para exportar nuevos componentes
3. ✅ Reemplazar dual guards en todos los controllers
4. ✅ Actualizar endpoints para usar `permissionService.getUserRepositoryPermission()`
5. ✅ Simplificar helpers de frontend
6. ✅ Documentar sistema unificado

**Estado actual**: ✅ Migración completa

---

## Testing

### Test de Jerarquía de Permisos

```typescript
describe("UnifiedPermissionGuard", () => {
  it("should allow superadmin full access", async () => {
    const user = { id: "admin-uuid", roles: ["superadmin"], permissions: [] };
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it("should allow global permission to override repository permission", async () => {
    const user = { id: "dev-uuid", roles: [], permissions: ["repo.write"] };
    // Sin permiso granular en repo específico
    const result = await guard.canActivate(context);
    expect(result).toBe(true); // Global override
  });

  it("should allow repository-specific permission when no global", async () => {
    const user = { id: "contractor-uuid", roles: [], permissions: [] };
    // Con permiso granular 'read' en repo-1
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it("should deny when no permission at any level", async () => {
    const user = { id: "guest-uuid", roles: [], permissions: [] };
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException
    );
  });
});
```

---

## Troubleshooting

### Problema: Usuario no puede acceder aunque tiene permiso global

**Causa**: JWT no incluye permisos/roles actualizados  
**Solución**: Re-login para obtener nuevo token con datos actualizados

### Problema: Permiso granular no funciona

**Verificar**:

```sql
SELECT * FROM repository_permissions
WHERE user_id = 'user-uuid' AND repository_id = 'repo-uuid';
```

**Verificar roles**:

```sql
SELECT rp.* FROM repository_permissions rp
JOIN user_roles ur ON ur.role_id = rp.role_id
WHERE ur.user_id = 'user-uuid' AND rp.repository_id = 'repo-uuid';
```

### Problema: Frontend muestra botones incorrectos

**Causa**: `repo.userPermission` no se calcula en backend  
**Solución**: Verificar que endpoint usa `permissionService.getUserRepositoryPermission()`

---

## Best Practices

### 1. Asignar permisos por roles, no usuarios

✅ **Recomendado**:

```typescript
// Otorgar permiso al rol "developers"
await repoPermService.grantRolePermission(repoId, developersRoleId, "write");
// Todos los usuarios con rol "developers" heredan el permiso
```

❌ **Evitar**:

```typescript
// Otorgar permiso a cada usuario individualmente
for (const dev of developers) {
  await repoPermService.grantUserPermission(repoId, dev.id, "write");
}
// Difícil de mantener, no escala
```

### 2. Usar permisos globales para operaciones transversales

- CI/CD systems → `repo.write` global
- Monitoring tools → `repo.read` global
- Platform admins → `repo.manage` global

### 3. Usar permisos granulares para acceso restringido

- Contractors externos
- Equipos con ámbito limitado
- Repositorios sensibles/confidenciales

### 4. Revisar permisos periódicamente

```sql
-- Listar usuarios con acceso a repositorio sensible
SELECT u.username, rp.permission
FROM repository_permissions rp
JOIN users u ON u.id = rp.user_id
WHERE rp.repository_id = 'sensitive-repo-uuid';
```

---

## Referencias

- **Guard unificado**: `apps/api/src/modules/rbac/unified-permission.guard.ts`
- **Servicio de permisos**: `apps/api/src/modules/rbac/permission.service.ts`
- **Servicio granular**: `apps/api/src/modules/repos/repository-permission.service.ts`
- **Frontend helpers**: `apps/web/src/components/Repos/repo-permissions.ts`
- **Entidad BD**: `apps/api/src/entities/repository-permission.entity.ts`
- **Migración BD**: `apps/api/src/migrations/*CreateRepositoryPermissions.ts`

---

## Permisos de Gestión de Usuarios y Roles

### Permisos Globales para Usuarios

| Permiso | Descripción | Operaciones Permitidas |
|---------|-------------|----------------------|
| `user.read` | Lectura de usuarios | Ver lista de usuarios, detalles de perfiles |
| `user.write` | Escritura en usuarios | Actualizar información de usuarios (nombre, password) |
| `user.manage` | Administración de usuarios | Crear/eliminar usuarios, gestionar roles asignados |

### Permisos Globales para Roles

| Permiso | Descripción | Operaciones Permitidas |
|---------|-------------|----------------------|
| `role.read` | Lectura de roles | Ver lista de roles y permisos asignados |
| `role.manage` | Administración de roles | Crear/modificar/eliminar roles y sus permisos |

### Protección Anti-Auto-Eliminación

⚠️ **Regla crítica**: Un usuario **NO puede eliminarse a sí mismo**, incluso si tiene el permiso `user.manage` o es admin/superadmin.

**Endpoint protegido**: `DELETE /users/:id`

**Validación implementada**:
```typescript
if (req.user && req.user.id === id) {
  throw new HttpException(
    'Cannot delete your own account',
    HttpStatus.FORBIDDEN,
  );
}
```

**Razón**: Prevenir bloqueo accidental del sistema al eliminar la última cuenta con permisos administrativos.

### Ejemplos de Uso

#### Escenario 1: Admin gestiona usuarios
```typescript
// Admin puede listar todos los usuarios
GET /users
Headers: { Authorization: "Bearer <admin_token>" }
Permissions Required: user.read ✅

// Admin puede crear nuevo usuario
POST /users
Body: { username: "developer", password: "pass123", roles: ["developer"] }
Permissions Required: user.manage ✅

// Admin NO puede eliminar su propia cuenta
DELETE /users/<admin_user_id>
Response: 403 Forbidden - "Cannot delete your own account" ❌

// Admin SÍ puede eliminar otros usuarios
DELETE /users/<other_user_id>
Permissions Required: user.manage ✅
```

#### Escenario 2: Usuario con permisos limitados
```typescript
// Usuario con user.read puede ver lista
GET /users
Permissions Required: user.read ✅

// Usuario con user.write puede actualizar usuarios
PUT /users/:id
Body: { displayName: "New Name" }
Permissions Required: user.write ✅

// Usuario SIN user.manage NO puede crear usuarios
POST /users
Response: 403 Forbidden - "Missing required permissions: user.manage" ❌
```

#### Escenario 3: Gestión de roles
```typescript
// Admin puede ver todos los roles
GET /rbac/roles
Permissions Required: role.read ✅

// Admin puede crear nuevo rol con permisos
POST /rbac/roles
Body: { name: "developer", permissions: ["repo.read", "repo.write"] }
Permissions Required: role.manage ✅

// Admin puede eliminar roles
DELETE /rbac/roles/:id
Permissions Required: role.manage ✅
```

### Endpoints Afectados

#### Usuarios (`/users`)
- `GET /users` - Requiere `user.read`
- `GET /users/:id` - Requiere `user.read`
- `POST /users` - Requiere `user.manage`
- `PUT /users/:id` - Requiere `user.write`
- `DELETE /users/:id` - Requiere `user.manage` + validación anti-auto-eliminación

#### Roles (`/rbac/roles`)
- `GET /rbac/roles` - Requiere `role.read`
- `GET /rbac/roles/:id` - Requiere `role.read`
- `POST /rbac/roles` - Requiere `role.manage`
- `PUT /rbac/roles/:id` - Requiere `role.manage`
- `DELETE /rbac/roles/:id` - Requiere `role.manage`

#### Permisos (`/rbac/permissions`)
- `GET /rbac/permissions` - Requiere `role.read`

### Migración y Setup

Los permisos se crean automáticamente mediante migración:

**Migración**: `1733500000000-AddUserAndRolePermissions.ts`

```sql
INSERT INTO permissions (key, description) VALUES
  ('user.read', 'View user information'),
  ('user.write', 'Update user information'),
  ('user.manage', 'Create/delete users and manage their roles'),
  ('role.read', 'View roles and permissions'),
  ('role.manage', 'Create/modify/delete roles and their permissions');

-- Asignar automáticamente a roles admin/superadmin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('superadmin', 'admin')
  AND p.key IN ('user.read', 'user.write', 'user.manage', 'role.read', 'role.manage');
```

### Tests de Verificación

```bash
# Login como admin
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin@admin.com","password":"1234"}' \
  | jq -r '.token')

# ✅ Listar usuarios (debe funcionar)
curl -s http://localhost:3000/users -H "Authorization: Bearer $TOKEN"

# ✅ Crear usuario (debe funcionar)
curl -s -X POST http://localhost:3000/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test123"}'

# ❌ Eliminar propia cuenta (debe fallar)
USER_ID=$(curl -s http://localhost:3000/users -H "Authorization: Bearer $TOKEN" \
  | jq -r '.[] | select(.username=="admin@admin.com") | .id')
curl -s -X DELETE "http://localhost:3000/users/$USER_ID" \
  -H "Authorization: Bearer $TOKEN"
# Response: {"message":"Cannot delete your own account"}

# ✅ Eliminar otro usuario (debe funcionar)
curl -s -X DELETE "http://localhost:3000/users/<other_user_id>" \
  -H "Authorization: Bearer $TOKEN"
```

---
