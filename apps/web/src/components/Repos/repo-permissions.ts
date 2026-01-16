/**
 * Unified Permission Helpers
 * 
 * The backend now handles all permission logic (superadmin/admin > global > repository-specific)
 * and returns the effective permission level in repo.userPermission.
 * 
 * Frontend only needs to:
 * 1. Check if repo.userPermission exists (populated by backend)
 * 2. Verify the permission level meets the requirement
 */

export function hasGlobalPermission(user: any | null, perm: string) {
    if (!user) return false;
    if (Array.isArray(user.permissions) && (user.permissions.includes('*') || user.permissions.includes(perm))) return true;
    return false;
}

/**
 * Check if user can perform an action on a repository
 * Backend pre-calculates the effective permission level considering:
 * - Superadmin/Admin roles (full access)
 * - Global permissions (repo.read, repo.write, repo.manage)
 * - Repository-specific permissions (granular control)
 * 
 * @param repo - Repository object with userPermission field populated by backend
 * @param permission - Required permission ('read', 'write', 'admin' or 'repo.read', 'repo.write', 'repo.manage')
 * @returns true if user has sufficient permission
 */
export function canPerformOnRepo(repo: any, permission: string) {
    if (!repo || !repo.userPermission) {
        // No permission info from backend, deny by default
        return false;
    }

    // Map permission levels (backend uses: read=1, write=2, admin=3)
    const permissionLevels: Record<string, number> = { read: 1, write: 2, admin: 3 };
    const userLevel = permissionLevels[repo.userPermission] || 0;

    // Map string permissions to required levels
    const requiredLevel = (() => {
        if (permission === 'repo.manage' || permission === 'admin') return 3;
        if (permission === 'repo.write' || permission === 'write') return 2;
        if (permission === 'repo.read' || permission === 'read') return 1;
        return 999; // Unknown permission, deny access
    })();

    return userLevel >= requiredLevel;
}
