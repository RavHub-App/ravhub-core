# Activación de Licencia y Recarga Dinámica de Plugins

## Problema Original

Antes, cuando un usuario activaba una licencia empresarial, los plugins adicionales (NuGet, Composer, Helm, Rust, Raw) **NO se activaban automáticamente**. Era necesario reiniciar manualmente la aplicación para que se cargaran.

Esto creaba una mala experiencia de usuario y confusión.

## Solución Implementada

### 1. Recarga Dinámica de Plugins

Ahora, cuando se activa una licencia:

1. ✅ La licencia se valida y guarda en la base de datos
2. ✅ **Automáticamente** se recargan los plugins sin reiniciar
3. ✅ Los plugins empresariales se activan de inmediato
4. ✅ El usuario puede usar las funciones empresariales al instante

### 2. Flujo de Activación

```
Usuario activa licencia
         ↓
POST /license/activate
         ↓
LicenseService.activateLicense()
         ↓
Valida JWT con portal
         ↓
Guarda licencia en DB
         ↓
🔄 PluginsService.reloadPlugins()  ← NUEVO
         ↓
✅ Plugins empresariales activados
```

### 3. Endpoints Nuevos

#### `GET /plugins/status`

Retorna el estado actual de los plugins:

```json
{
  "loaded": ["npm", "pypi", "docker", "maven"],
  "available": [
    "npm",
    "pypi",
    "docker",
    "maven",
    "nuget",
    "composer",
    "helm",
    "rust",
    "raw"
  ],
  "community": ["npm", "pypi", "docker", "maven"],
  "enterprise": ["nuget", "composer", "helm", "rust", "raw"],
  "restricted": ["nuget", "composer", "helm", "rust", "raw"],
  "requiresLicense": true
}
```

#### `POST /plugins/reload`

Permite recargar plugins manualmente (útil si hay un problema):

```json
{
  "ok": true,
  "message": "Successfully enabled 5 enterprise plugins",
  "newPlugins": ["nuget", "composer", "helm", "rust", "raw"]
}
```

### 4. Integración en la UI

#### Settings Page - License Section

```tsx
// Ejemplo de implementación en React/Next.js

const LicenseSettings = () => {
  const [pluginStatus, setPluginStatus] = useState(null);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    fetch("/api/plugins/status")
      .then((r) => r.json())
      .then(setPluginStatus);
  }, []);

  const handleActivateLicense = async (key) => {
    setActivating(true);
    try {
      const response = await fetch("/api/license/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });

      const result = await response.json();

      if (result.success) {
        // Refresh plugin status to show newly enabled plugins
        const newStatus = await fetch("/api/plugins/status").then((r) =>
          r.json()
        );
        setPluginStatus(newStatus);

        toast.success(
          "License activated! Enterprise features are now available."
        );
      } else {
        toast.error(result.message);
      }
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="license-settings">
      <h2>License</h2>

      {/* Show current plugin status */}
      {pluginStatus && (
        <div className="plugin-status">
          <h3>Available Features</h3>
          <div className="features-grid">
            {pluginStatus.available.map((plugin) => (
              <div
                key={plugin}
                className={`feature-card ${
                  pluginStatus.loaded.includes(plugin) ? "enabled" : "disabled"
                }`}
              >
                <Icon name={plugin} />
                <span>{plugin.toUpperCase()}</span>
                {!pluginStatus.loaded.includes(plugin) && (
                  <Badge variant="warning">Requires License</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* License activation form */}
      {pluginStatus?.requiresLicense && (
        <Alert variant="info">
          <AlertIcon />
          <div>
            <AlertTitle>Community Edition</AlertTitle>
            <AlertDescription>
              You're currently running the Community Edition with{" "}
              {pluginStatus.community.length} package managers.
              <br />
              Activate an Enterprise license to unlock{" "}
              {pluginStatus.enterprise.length} additional features:
              <strong> {pluginStatus.enterprise.join(", ")}</strong>
            </AlertDescription>
          </div>
        </Alert>
      )}

      <LicenseActivationForm
        onActivate={handleActivateLicense}
        loading={activating}
      />
    </div>
  );
};
```

#### Banner de Alerta (Opcional)

```tsx
// Banner que aparece en la parte superior si están usando Community Edition
const CommunityEditionBanner = () => {
  const { pluginStatus } = usePlugins();

  if (!pluginStatus?.requiresLicense) return null;

  return (
    <Banner variant="info" dismissible>
      <BannerIcon icon="info" />
      <BannerContent>
        <BannerTitle>Community Edition</BannerTitle>
        <BannerDescription>
          You're using the Community Edition.
          <Link href="/settings/license">Activate a license</Link> to unlock{" "}
          {pluginStatus.restricted.length} enterprise features.
        </BannerDescription>
      </BannerContent>
    </Banner>
  );
};
```

### 5. Indicadores Visuales

#### En la Lista de Plugins/Features

```tsx
{
  plugins.map((plugin) => (
    <Card key={plugin.key}>
      <CardHeader>
        <PluginIcon name={plugin.key} />
        <h3>{plugin.name}</h3>
        {!plugin.enabled && <LockIcon />}
      </CardHeader>
      <CardContent>
        {plugin.enabled ? (
          <Badge variant="success">Active</Badge>
        ) : (
          <div>
            <Badge variant="secondary">Enterprise Feature</Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/settings/license")}
            >
              Activate License
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  ));
}
```

### 6. Notificaciones Post-Activación

Cuando se activa exitosamente una licencia:

```tsx
// Auto-mostrar modal con los nuevos plugins habilitados
const showActivationSuccess = (newPlugins) => {
  Modal.show({
    title: "🎉 License Activated!",
    content: (
      <div>
        <p>Your Enterprise license has been activated successfully.</p>
        <h4>Newly enabled features:</h4>
        <ul>
          {newPlugins.map((plugin) => (
            <li key={plugin}>
              <Icon name={plugin} /> {plugin.toUpperCase()}
            </li>
          ))}
        </ul>
        <p className="text-muted">
          These features are now available immediately. No restart required!
        </p>
      </div>
    ),
    actions: [
      {
        label: "Create Repository",
        onClick: () => navigate("/repositories/new"),
      },
      { label: "Close", variant: "secondary" },
    ],
  });
};
```

### 7. Recarga Manual (Fallback)

En caso de que algo falle, proporcionar un botón de recarga manual:

```tsx
const ReloadPluginsButton = () => {
  const [loading, setLoading] = useState(false);

  const handleReload = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/plugins/reload", { method: "POST" });
      const result = await response.json();

      if (result.ok) {
        toast.success(result.message);
        window.location.reload(); // Refresh UI
      } else {
        toast.error(result.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleReload}
      loading={loading}
    >
      <RefreshIcon />
      Reload Plugins
    </Button>
  );
};
```

## Ventajas de esta Implementación

1. ✅ **Experiencia de usuario mejorada**: Activación instantánea
2. ✅ **No requiere reinicio**: Los plugins se cargan dinámicamente
3. ✅ **Transparencia**: El usuario ve qué features tiene disponibles
4. ✅ **Feedback inmediato**: Notificaciones cuando se activan nuevos plugins
5. ✅ **Recuperación de errores**: Botón de recarga manual si algo falla
6. ✅ **Estado visible**: Indicadores claros de qué requiere licencia

## Testing

### Test Manual en Minikube

1. Iniciar sin licencia:

   ```bash
   minikube kubectl -- logs -f deployment/ravhub
   # Verificar: "Running in Community Edition"
   # Verificar: "Restricted 5 Enterprise plugins"
   ```

2. Verificar plugins cargados:

   ```bash
   curl http://ravhub.local/api/plugins/status
   # Debe mostrar solo 4 plugins en "loaded"
   ```

3. Activar licencia:

   ```bash
   curl -X POST http://ravhub.local/api/license/activate \
     -H "Content-Type: application/json" \
     -d '{"key":"ENTERPRISE-LICENSE-KEY"}'
   ```

4. Verificar recarga automática en logs:

   ```bash
   # Debe aparecer:
   # "🔄 Reloading plugins after license change..."
   # "✅ Enabled 5 new plugins: nuget, composer, helm, rust, raw"
   ```

5. Confirmar plugins activos:
   ```bash
   curl http://ravhub.local/api/plugins/status
   # Debe mostrar 9 plugins en "loaded"
   # "requiresLicense": false
   ```

### Test Unitario

Agregar test para verificar la recarga dinámica:

```typescript
it("should reload plugins after license activation", async () => {
  // Start with no license (Community Edition)
  mockLicenseRepo.findOne.mockResolvedValue(null);
  await service.onModuleInit();

  let loaded = service.list();
  expect(loaded).toHaveLength(4); // Only community plugins

  // Activate license
  mockLicenseRepo.findOne.mockResolvedValue({
    id: "test",
    isActive: true,
  });

  // Reload plugins
  const result = await service.reloadPlugins();

  expect(result.ok).toBe(true);
  expect(result.newPlugins).toHaveLength(5);
  expect(result.newPlugins).toContain("nuget");
  expect(result.newPlugins).toContain("composer");

  loaded = service.list();
  expect(loaded).toHaveLength(9); // All plugins
});
```

## Conclusión

Esta implementación **elimina la necesidad de reiniciar** después de activar una licencia y proporciona una **experiencia de usuario transparente** donde se puede ver claramente qué features están disponibles y cuáles requieren licencia.

La UI puede mostrar indicadores claros y permitir una activación fluida con feedback inmediato.
