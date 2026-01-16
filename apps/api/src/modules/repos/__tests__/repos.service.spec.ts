import { ReposService } from '../repos.service';

describe('ReposService.normalize', () => {
  it('prefers explicit docker accessUrl from config', async () => {
    const ent = {
      id: 'r1',
      name: 'r1',
      manager: 'docker',
      config: { docker: { port: 5012, accessUrl: 'http://custom:5012' } },
    } as any;
    const repo = { find: jest.fn(async () => [ent]) } as any;
    const s = new ReposService(
      repo,
      {} as any,
      { list: () => [] } as any,
      { getUpstreamPingStatus: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const out = await s.findAll();
    expect(out).toHaveLength(1);
    expect(out[0].accessUrl).toBe('http://custom:5012');
  });

  it('constructs host:port from REGISTRY_HOST when accessUrl not provided', async () => {
    process.env.REGISTRY_HOST = 'registry.example';
    process.env.REGISTRY_PROTOCOL = 'https';
    const ent = {
      id: 'r2',
      name: 'r2',
      manager: 'docker',
      config: { docker: { port: 6020 } },
    } as any;
    const repo = { find: jest.fn(async () => [ent]) } as any;
    const s = new ReposService(
      repo,
      {} as any,
      { list: () => [] } as any,
      { getUpstreamPingStatus: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const out = await s.findAll();
    expect(out[0].accessUrl).toBe('https://registry.example:6020');
    delete process.env.REGISTRY_HOST;
    delete process.env.REGISTRY_PROTOCOL;
  });

  it('includes plugin icon when matching plugin metadata exists', async () => {
    const ent = { id: 'r3', name: 'r3', manager: 'npm', config: {} } as any;
    const repo = { find: jest.fn(async () => [ent]) } as any;
    const pluginsStub: any = {
      list: () => [{ key: 'npm', icon: '/plugins/npm/icon' }],
    };
    const pluginManagerStub: any = {
      getUpstreamPingStatus: jest.fn().mockReturnValue(true),
    };
    const s = new ReposService(
      repo,
      {} as any,
      pluginsStub,
      pluginManagerStub,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const out = await s.findAll();
    expect(out[0].icon).toBe('/plugins/npm/icon');
  });
});
