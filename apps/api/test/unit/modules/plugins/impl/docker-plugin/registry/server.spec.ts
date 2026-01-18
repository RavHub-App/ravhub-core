/**
 * Basic structural tests for Docker Registry Server
 *
 * Note: Full HTTP server behavior is better tested via integration tests.
 * This file validates module structure and exports.
 */

describe('DockerPlugin Registry Server', () => {
  let serverModule: any;

  beforeEach(() => {
    jest.resetModules();
    serverModule = require('src/modules/plugins/impl/docker-plugin/registry/server');
  });

  it('should export startRegistryForRepo function', () => {
    expect(serverModule.startRegistryForRepo).toBeDefined();
    expect(typeof serverModule.startRegistryForRepo).toBe('function');
  });

  it('should export stopRegistryForRepo function', () => {
    expect(serverModule.stopRegistryForRepo).toBeDefined();
    expect(typeof serverModule.stopRegistryForRepo).toBe('function');
  });

  it('should export getRegistryServers function', () => {
    expect(serverModule.getRegistryServers).toBeDefined();
    expect(typeof serverModule.getRegistryServers).toBe('function');
  });

  // Note: Full HTTP request/response testing is handled in integration tests
  // due to the complexity of mocking Node's http module and the registry's
  // tightly coupled server logic.
});
