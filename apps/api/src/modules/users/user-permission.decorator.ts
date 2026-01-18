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
