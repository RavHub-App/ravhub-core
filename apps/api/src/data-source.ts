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

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as Entities from './entities';
import { Migration1701163200000 } from './migrations/1701163200000-InitialMigration';
import { Migration1701163300000 } from './migrations/1701163300000-AddManagerToRepositories';
import { Migration1701163400000 } from './migrations/1701163400000-add-permissions';
import { Migration1701163500000 } from './migrations/1701163500000-add-user-passwordHash';
import { Migration1701163600000 } from './migrations/1701163600000-add-repository-roles';
import { Migration1701163700000 } from './migrations/1701163700000-add-storage-configs';
import { Migration1701163800000 } from './migrations/1701163800000-create-artifacts-table';
import { Migration1733320800000 } from './migrations/1733320800000-add-lastAccessedAt-to-artifacts';
import { Migration1733500000000 } from './migrations/1733500000000-AddUserAndRolePermissions';
import { Migration1733510000000 } from './migrations/1733510000000-AddBackupPermissions';
import { Migration1733520000000 } from './migrations/1733520000000-CreateBackupTables';
import { Migration1733530000000 } from './migrations/1733530000000-CreateRepositoryPermissions';
import { Migration1733950000000 } from './migrations/1733950000000-AddPluginsStorageConfig';
import { Migration1733950100000 } from './migrations/1733950100000-AddUsageToStorageConfig';
import { Migration1733950200000 } from './migrations/1733950200000-UpdatePluginsStorageUsage';
import { Migration1733950300000 } from './migrations/1733950300000-AddBackupStorageConfig';
import { Migration1734100000001 } from './migrations/1734100000001-AddRefreshTokenToUsers';
import { Migration1736070000000 } from './migrations/1736070000000-AddPathAndHashToArtifacts';

const host = process.env.POSTGRES_HOST || 'localhost';
const port = parseInt(process.env.POSTGRES_PORT || '5432', 10);
const username = process.env.POSTGRES_USER || 'postgres';
const password = process.env.POSTGRES_PASSWORD || 'postgres';
const database = process.env.POSTGRES_DB || 'ravhub';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host,
  port,
  username,
  password,
  database,
  entities: Object.values(Entities),
  synchronize: false,
  logging: false,
  migrations: [
    Migration1701163200000,
    Migration1701163300000,
    Migration1701163400000,
    Migration1701163500000,
    Migration1701163600000,
    Migration1701163700000,
    Migration1701163800000,
    Migration1733320800000,
    Migration1733500000000,
    Migration1733510000000,
    Migration1733520000000,
    Migration1733530000000,
    Migration1733950000000,
    Migration1733950100000,
    Migration1733950200000,
    Migration1733950300000,
    Migration1734100000001,
    Migration1736070000000,
  ],
  migrationsTableName: 'migrations',
});

export default AppDataSource;
