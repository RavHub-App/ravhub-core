import { Test, TestingModule } from '@nestjs/testing';
import { ReposController } from '../repos.controller';
import { PermissionsGuard } from '../../rbac/permissions.guard';
import { UsersService } from '../../users/users.service';
import { AuthService } from '../../auth/auth.service';
import { ReposService } from '../repos.service';
import { PluginManagerService } from '../../plugins/plugin-manager.service';

describe('ReposController (unit)', () => {
  let controller: ReposController;

  const reposService = {
    findAll: jest.fn(async () => []),
    update: jest.fn(async (id: string, data: any) => ({ id, ...data })),
    create: jest.fn(async (body: any) => ({ id: 'new', ...body })),
  };

  const pluginManager = {
    upload: jest.fn(),
    download: jest.fn(),
    listVersions: jest.fn(),
    proxyFetch: jest.fn(),
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReposController],
      providers: [
        { provide: ReposService, useValue: reposService },
        { provide: PluginManagerService, useValue: pluginManager },
        {
          provide: UsersService,
          useValue: { findByUsername: jest.fn(), create: jest.fn() },
        },
        { provide: AuthService, useValue: { signToken: jest.fn(() => 'tok') } },
      ],
    })
      // tests don't need to exercise the guard logic here — override with a permissive stub
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ReposController>(ReposController);
  });

  it('returns [] when repos.findAll throws (startup DB race)', async () => {
    // simulate DB errors
    (reposService.findAll as jest.Mock).mockRejectedValueOnce(
      new Error('db not ready'),
    );
    const out = await controller.list({ path: '/', url: '/', user: { username: 'test' } } as any);
    expect(out).toEqual([]);
  });

  it('allows updating a repository via PUT and delegates to service', async () => {
    const out = await controller.update('r1', {
      config: { docker: { port: 5010 } },
    } as any);
    expect(reposService.update).toHaveBeenCalledWith('r1', {
      config: { docker: { port: 5010 } },
    });
    expect(out).toEqual({ id: 'r1', config: { docker: { port: 5010 } } });
  });

  it('rejects creating a proxy repository when upstream URL is missing', async () => {
    const body = {
      name: 'proxy-repo',
      manager: 'maven',
      type: 'proxy',
      config: {},
    } as any;
    await expect(controller.create(body)).rejects.toThrow(
      /proxy repositories require a proxy URL/,
    );
  });

  it('allows creating a proxy repository when upstream URL is provided', async () => {
    const body = {
      name: 'proxy-repo',
      manager: 'maven',
      type: 'proxy',
      config: { target: 'https://repo.example' },
    } as any;
    const saved = await controller.create(body);
    expect(reposService.create).toHaveBeenCalledWith(body);
    expect(saved).toEqual({ id: 'new', ...body });
  });
});
