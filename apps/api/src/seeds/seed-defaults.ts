import AppDataSource from '../data-source';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RepositoryEntity } from '../entities/repository.entity';
import { User } from '../entities/user.entity';
import * as bcrypt from 'bcryptjs';
import { StorageConfig } from '../entities/storage-config.entity';

export async function seedDefaults() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const roleRepo = AppDataSource.getRepository(Role);
  const permRepo = AppDataSource.getRepository(Permission);
  const repoRepo = AppDataSource.getRepository(RepositoryEntity);

  const rolesToEnsure = [
    {
      name: 'superadmin',
      description: 'Super administrator - full access to everything',
    },
    { name: 'admin', description: 'Administrator - full access' },
    { name: 'reader', description: 'Read-only access' },
  ];

  for (const r of rolesToEnsure) {
    const found = await roleRepo.findOneBy({ name: r.name });
    if (!found) {
      const created = roleRepo.create(r);
      await roleRepo.save(created);
      console.log(`seed: created role ${r.name}`);
    } else {
      console.log(`seed: role ${r.name} already exists`);
    }
  }

  // ensure permissions
  const permsToEnsure = [
    { key: 'repo.read', description: 'Read access to repository and packages' },
    { key: 'repo.write', description: 'Write/upload access to repository' },
    { key: 'repo.manage', description: 'Create/modify/delete repositories' },
    { key: 'system.admin', description: 'Full system administration' },
  ];

  for (const p of permsToEnsure) {
    const found = await permRepo.findOneBy({ key: p.key });
    if (!found) {
      const created = permRepo.create(p);
      await permRepo.save(created);
      console.log(`seed: created permission ${p.key}`);
    } else {
      console.log(`seed: permission ${p.key} already exists`);
    }
  }

  // Ensure role-permission mappings (admin => all, reader => repo.read)
  const admin = await roleRepo.findOne({
    where: { name: 'admin' },
    relations: ['permissions'],
  });
  const reader = await roleRepo.findOne({
    where: { name: 'reader' },
    relations: ['permissions'],
  });
  const allPerms = await permRepo.find();

  if (admin) {
    admin.permissions = allPerms;
    await roleRepo.save(admin);
    console.log('seed: admin role assigned all permissions');
  }

  const superadminRole = await roleRepo.findOne({
    where: { name: 'superadmin' },
    relations: ['permissions'],
  });
  if (superadminRole) {
    superadminRole.permissions = allPerms;
    await roleRepo.save(superadminRole);
    console.log('seed: superadmin role assigned all permissions');
  }

  if (reader) {
    const read = await permRepo.findOneBy({ key: 'repo.read' });
    reader.permissions = read ? [read] : [];
    await roleRepo.save(reader);
    console.log('seed: reader role assigned repo.read');
  }

  // Note: do not add docker example repo by default. Tests should create their
  // own repositories when required so seeds stay idempotent and predictable.

  // In production we want some standard Maven repositories preinstalled — create
  // a small set of maven repos when running in production contexts. This keeps
  // development/tests lightweight while ensuring production images contain
  // preconfigured maven repos.

  // ensure a default storage config exists (filesystem)
  try {
    const cfgRepo = AppDataSource.getRepository(StorageConfig);

    // Check if any default storage config exists
    const existingDefault = await cfgRepo.findOneBy({ isDefault: true });

    if (!existingDefault) {
      // Determine storage type from environment (Helm chart bootstrapping)
      let type = 'filesystem';
      let key = 'default-fs';
      let config: any = {};

      if (process.env.STORAGE_TYPE === 's3' || process.env.S3_BUCKET) {
        type = 's3';
        key = 'default-s3';
        config = {
          bucket: process.env.S3_BUCKET,
          region: process.env.S3_REGION,
          // Store keys only if they are not provided via IAM or standard envs implicitly
          // But to be safe for adapter reconstruction from DB:
          accessKey: process.env.S3_ACCESS_KEY,
          secretKey: process.env.S3_SECRET_KEY,
        };
      } else if (
        process.env.STORAGE_TYPE === 'gcs' ||
        process.env.GCS_BUCKET
      ) {
        type = 'gcs';
        key = 'default-gcs';
        config = {
          bucket: process.env.GCS_BUCKET,
          projectId: process.env.GCP_PROJECT,
        };
      } else if (
        process.env.STORAGE_TYPE === 'azure' ||
        process.env.AZURE_CONTAINER
      ) {
        type = 'azure';
        key = 'default-azure';
        config = {
          container: process.env.AZURE_CONTAINER,
          connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
        };
      }

      await cfgRepo.save(
        cfgRepo.create({
          key,
          type,
          config,
          isDefault: true,
        }),
      );
      console.log(`seed: created default storage config (${type})`);
    } else {
      console.log('seed: default storage config already exists');
    }
  } catch (err) {
    // ignore if StorageConfig table not present yet
  }

  // Do not destroy here to allow caller to run additional actions (like migrations then seed)

  // Historically the seed created a default admin user automatically (username 'admin').
  // Now that a one-time bootstrap endpoint exists (POST /auth/bootstrap), it's safer
  // to avoid creating a password-less/default admin during seeds. To preserve
  // compatibility for CI or special setups, set SEED_CREATE_ADMIN=true in the env
  // to opt-in to creating the seeded admin (using SEED_ADMIN_PASSWORD or default).
  try {
    const doCreateAdmin =
      String(process.env.SEED_CREATE_ADMIN || '').toLowerCase() === 'true';
    if (!doCreateAdmin) {
      console.log(
        'seed: skipping creation of default admin (use /auth/bootstrap for first-admin)',
      );
    } else {
      const userRepo = AppDataSource.getRepository(User);
      const adminUser = await userRepo.findOneBy({ username: 'admin' });
      if (!adminUser) {
        const pw = process.env.SEED_ADMIN_PASSWORD || 'admin123';
        const hash = await bcrypt.hash(pw, 10);
        // ensure roles is a Role[] (admin may be null) — cast to satisfy TypeORM typings
        const created = userRepo.create({
          username: 'admin',
          passwordhash: hash,
          roles: admin ? ([admin] as Role[]) : [],
        });
        await userRepo.save(created);
        console.log('seed: created admin user (username=admin)');
      } else {
        console.log('seed: admin user already exists');
      }
    }
  } catch (err) {
    // if something goes wrong (missing User table), just skip admin creation
    console.log('seed: skipping admin creation due to error or missing schema');
  }
}

if (require.main === module) {
  seedDefaults()
    .then(() => {
      console.log('seeds applied');
      process.exit(0);
    })
    .catch((err) => {
      console.error('seed error', err);
      process.exit(1);
    });
}
