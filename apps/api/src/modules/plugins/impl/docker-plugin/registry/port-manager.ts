/**
 * Port management for Docker registry server
 * Handles port selection and availability checking
 */

/**
 * Find an available port for the registry
 * If port is 0, auto-selects from configured range
 * Otherwise verifies the requested port is available
 */
export async function selectPort(
  requestedPort?: number,
): Promise<{ port: number; needsPersistence: boolean }> {
  const net = require('net');
  let port = requestedPort;
  let needsPersistence = false;

  // minimal logging: debug information only
  if (process.env.DEBUG_REGISTRY_PORT === 'true')
    console.debug('[REGISTRY PORT SELECT] requested:', requestedPort);

  // If port is 0, it means "auto-select a free port once and persist it"
  if (port === 0) {
    const rangeStart = parseInt(process.env.REGISTRY_PORT_START || '5000', 10);
    const rangeEnd = parseInt(process.env.REGISTRY_PORT_END || '5100', 10);

    for (let p = rangeStart; p <= rangeEnd; p++) {
      const ok = await isPortAvailable(p);
      if (ok) {
        port = p;
        needsPersistence = true;
        break;
      }
    }

    if (!port) {
      throw new Error(
        `no available ports found in registry mapping range ${rangeStart}-${rangeEnd}`,
      );
    }
    if (process.env.DEBUG_REGISTRY_PORT === 'true')
      console.debug('[REGISTRY PORT SELECT] auto-selected port:', port);
  } else if (port) {
    // Specific port requested - verify it's available
    const isAvailable = await isPortAvailable(port);

    if (!isAvailable) {
      throw new Error(`requested port ${port} is already in use`);
    }
    if (process.env.DEBUG_REGISTRY_PORT === 'true')
      console.debug('[REGISTRY PORT SELECT] using requested port:', port);
  } else {
    throw new Error('port is required (use 0 for auto-selection)');
  }

  return { port, needsPersistence };
}

/**
 * Check if a port is available
 */
async function isPortAvailable(port: number): Promise<boolean> {
  const net = require('net');
  return new Promise<boolean>((resolve) => {
    const s = net.createServer();
    s.once('error', () => {
      resolve(false);
    });
    s.once('listening', () => {
      s.close(() => resolve(true));
    });
    s.listen(port, '0.0.0.0');
  });
}
