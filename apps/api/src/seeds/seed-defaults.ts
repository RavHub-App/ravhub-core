/*
 * Copyright (C) 2026 RavHub Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 */

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

  try {
    const cfgRepo = AppDataSource.getRepository(StorageConfig);

    const existingDefault = await cfgRepo.findOneBy({ isDefault: true });

    if (!existingDefault) {
      let type = 'filesystem';
      let key = 'default-fs';
      let config: any = {};

      if (process.env.STORAGE_TYPE === 's3' || process.env.S3_BUCKET) {
        type = 's3';
        key = 'default-s3';
        config = {
          bucket: process.env.S3_BUCKET,
          region: process.env.S3_REGION,
          accessKey: process.env.S3_ACCESS_KEY,
          secretKey: process.env.S3_SECRET_KEY,
        };
      } else if (process.env.STORAGE_TYPE === 'gcs' || process.env.GCS_BUCKET) {
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
