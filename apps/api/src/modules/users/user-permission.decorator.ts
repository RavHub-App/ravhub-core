import { SetMetadata } from '@nestjs/common';

/**
 * Decorator to specify required permission level for user operations
 * Similar to RepositoryPermission but for user management
 *
 * Levels:
 * - read: View user details
 * - write: Update user details (except roles)
 * - admin: Full control including role management and deletion
 */
export const UserPermission = (permission: 'read' | 'write' | 'admin') =>
  SetMetadata('userPermission', permission);
