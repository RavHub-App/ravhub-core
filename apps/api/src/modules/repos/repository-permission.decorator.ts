import { SetMetadata } from '@nestjs/common';

/**
 * Decorator to specify required repository permission level
 * Use with RepositoryPermissionGuard
 *
 * @example
 * @RepositoryPermission('read')
 * async downloadPackage() { ... }
 *
 * @example
 * @RepositoryPermission('write')
 * async uploadPackage() { ... }
 */
export const RepositoryPermission = (permission: 'read' | 'write' | 'admin') =>
  SetMetadata('repositoryPermission', permission);
