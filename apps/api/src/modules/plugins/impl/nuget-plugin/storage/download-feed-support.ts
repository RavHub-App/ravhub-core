import type { Repository } from '../utils/types';
import {
  getRepoBaseUrl,
  parseProxyBodyAsJson,
  type ProxyFetchResponse,
} from './storage-helpers';

type ProxyFetch = (
  repo: Repository,
  path: string,
) => Promise<ProxyFetchResponse>;

type PackageBaseResource = {
  '@type'?: string;
  '@id'?: string;
};

type ServiceIndex = {
  resources?: PackageBaseResource[];
};

export function createPackageBaseResolver(proxyFetch?: ProxyFetch) {
  const packageBaseByRepoName: Record<string, string> = {};

  return async (repo: Repository): Promise<string | null> => {
    const cachedPackageBase = packageBaseByRepoName[repo.name];
    if (cachedPackageBase) {
      return cachedPackageBase;
    }

    if (!proxyFetch) {
      return null;
    }

    try {
      const response = await proxyFetch(repo, 'index.json');
      if (response.status !== 200) {
        return null;
      }

      const json = parseProxyBodyAsJson(response.body) as ServiceIndex;
      const resource = json.resources?.find(
        (item) => item['@type'] === 'PackageBaseAddress/3.0.0',
      );

      if (!resource?.['@id']) {
        return null;
      }

      const normalizedPackageBase = normalizePackageBaseAddress(
        repo,
        resource['@id'],
      );
      packageBaseByRepoName[repo.name] = normalizedPackageBase;
      return normalizedPackageBase;
    } catch (error) {
      console.warn(
        `[NuGetPlugin] Failed to resolve PackageBaseAddress for ${repo.name}: ${String(error)}`,
      );
      return null;
    }
  };
}

export function isNugetFeedMetadataRequest(pkgName: string) {
  const lowerCaseName = pkgName.toLowerCase();
  return pkgName === '' || pkgName === '/' || lowerCaseName === '$metadata';
}

export function extractNugetFeedPackageId(pkgName: string) {
  const idMatch = pkgName.match(/id='([^']+)'/i);
  return idMatch ? idMatch[1] : '';
}

export function rewriteNugetProxyFeedXml(
  repoName: string,
  upstreamUrl: string,
  body: ProxyFetchResponse['body'],
) {
  let xml = Buffer.isBuffer(body) ? body.toString() : String(body ?? '');
  const normalizedUpstreamUrl = upstreamUrl.replace(/\/$/, '');
  if (!normalizedUpstreamUrl) {
    return Buffer.from(xml);
  }

  const baseUrl = getRepoBaseUrl(repoName);
  const escapedUpstreamUrl = escapeRegExp(normalizedUpstreamUrl);
  xml = xml.replace(new RegExp(escapedUpstreamUrl, 'g'), baseUrl);

  return Buffer.from(xml);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePackageBaseAddress(repo: Repository, packageBase: string) {
  const repoBaseUrl = getRepoBaseUrl(repo.name);
  const localProxyPrefix = `${repoBaseUrl}/v3-proxy/`;
  if (packageBase.startsWith(localProxyPrefix)) {
    return packageBase.slice(`${repoBaseUrl}/`.length);
  }

  try {
    const parsedUrl = new URL(packageBase);
    const encodedRepoName = encodeURIComponent(repo.name);
    const localProxyPathPrefix = `/repository/${encodedRepoName}/v3-proxy/`;
    if (parsedUrl.pathname.startsWith(localProxyPathPrefix)) {
      const relativePath = parsedUrl.pathname.slice(
        `/repository/${encodedRepoName}/`.length,
      );
      return `${relativePath}${parsedUrl.search}${parsedUrl.hash}`;
    }
  } catch {
    return packageBase;
  }

  return packageBase;
}
