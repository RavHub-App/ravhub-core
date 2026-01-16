/**
 * Helper used across plugin to normalize image names for upstream requests.
 * Behavior is repository-configurable (repo.config.docker.libraryPrefix):
 *  - 'auto' (default) — apply library/ only for Docker Hub upstreams
 *  - 'enabled' — always add library/ for images without namespace
 *  - 'disabled' — never add library/
 */
export function normalizeImageName(
  imageName: string,
  proxyUrl: string,
  repo?: any,
): string {
  const cfg = repo?.config?.docker ?? repo?.config ?? {};
  // Legacy or advanced setting: libraryPrefix (string) kept for compatibility
  if (typeof cfg?.libraryPrefix === 'string') {
    const behavior = cfg.libraryPrefix || 'auto';
    if (behavior === 'disabled') return imageName;
    const hasNamespace = imageName.includes('/');
    const isDockerHub =
      String(proxyUrl).includes('registry-1.docker.io') ||
      String(proxyUrl).includes('docker.io');
    if (behavior === 'enabled')
      return hasNamespace ? imageName : `library/${imageName}`;
    // auto
    return isDockerHub && !hasNamespace ? `library/${imageName}` : imageName;
  }

  // New simple boolean: isDockerHub (checkbox). If explicitly set, obey it.
  if (typeof cfg?.isDockerHub === 'boolean') {
    const hasNamespace = imageName.includes('/');
    return cfg.isDockerHub && !hasNamespace
      ? `library/${imageName}`
      : imageName;
  }

  // Fallback (no config): auto-detect by upstream host
  const isDockerHub =
    String(proxyUrl).includes('registry-1.docker.io') ||
    String(proxyUrl).includes('docker.io');
  const hasNamespace = imageName.includes('/');
  return isDockerHub && !hasNamespace ? `library/${imageName}` : imageName;
}

/**
 * Shared state for uploads across the plugin
 */
export const uploads: Map<string, Buffer> = new Map();

/**
 * Shared state for upload targets (group repository routing)
 */
export const uploadTargets: Map<
  string,
  {
    groupId: string;
    targets: { repoId: string; uuid: string }[];
    policy: string;
  }
> = new Map();
