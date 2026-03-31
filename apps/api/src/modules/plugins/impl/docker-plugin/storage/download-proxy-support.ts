import { normalizeImageName } from '../utils/helpers';
import type { Repository } from '../utils/types';

function normalizeDockerRepositoryInput(name: string | string[]) {
    return Array.isArray(name) ? name.join('/') : name;
}

type ProxyFetch = (
    repo: Repository,
    url: string,
    options?: { skipCache?: boolean },
) => Promise<
    | {
        ok?: boolean;
        status?: number;
        message?: string;
        url?: string;
        storageKey?: string;
        body?: unknown;
    }
    | undefined
>;

type DownloadResult = {
    ok?: boolean;
    status?: number;
    message?: string;
    url?: string;
    storageKey?: string;
    data?: unknown;
};

export function resolveDockerProxyTarget(repo: Repository) {
    return (
        repo?.config?.proxyUrl ||
        repo?.config?.docker?.proxyUrl ||
        repo?.config?.upstream ||
        repo?.config?.docker?.upstream ||
        repo?.config?.target ||
        repo?.config?.registry ||
        null
    );
}

export function buildDockerUpstreamBlobUrls(
    name: string | string[],
    target: string,
    repo: Repository,
    digest: string,
) {
    const normalizedName = normalizeImageName(
        normalizeDockerRepositoryInput(name),
        target,
        repo,
    );
    const encodedName = normalizedName
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
    const targetBase = target.replace(/\/$/, '');
    const v2Prefix = /\/v2(\/|$)/.test(targetBase) ? '' : '/v2';
    const digestReference = encodeURIComponent(digest).replace(/%3A/gi, ':');

    return {
        normalizedName,
        upstreamManifest: `${targetBase}${v2Prefix}/${encodedName}/manifests/${digestReference}`,
        upstreamBlob: `${targetBase}${v2Prefix}/${encodedName}/blobs/${digestReference}`,
    };
}

export function encodeDockerRepositoryName(
    name: string | string[],
    target: string,
    repo: Repository,
) {
    return normalizeImageName(
        normalizeDockerRepositoryInput(name),
        target,
        repo,
    )
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
}

export function createProxyBlobDownloadTask(
    proxyFetch: ProxyFetch | null,
    repo: Repository,
    name: string | string[],
    digest: string,
    target: string,
    pendingDownloads: Map<string, Promise<DownloadResult>>,
    blobCoalesceKey: string,
) {
    return (async () => {
        try {
            const nameData = buildDockerUpstreamBlobUrls(name, target, repo, digest);
            if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
                console.debug('[PROXY FETCH BLOB]', {
                    upstreamManifest: nameData.upstreamManifest,
                    upstreamBlob: nameData.upstreamBlob,
                    digest,
                    nameStr: name,
                    normalizedName: nameData.normalizedName,
                    target,
                });
            }

            let fetched = await proxyFetch?.(repo, nameData.upstreamManifest);
            if (
                !fetched?.ok &&
                (fetched?.status === 404 || fetched?.status === 400)
            ) {
                if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
                    console.debug(
                        `[PROXY FETCH BLOB] Manifest/Ref failed (status ${fetched.status}), trying blob endpoint`,
                    );
                }
                fetched = await proxyFetch?.(repo, nameData.upstreamBlob);
            }

            if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
                console.debug('[PROXY FETCH BLOB RESULT]', {
                    ok: fetched?.ok,
                    status: fetched?.status,
                    hasUrl: !!fetched?.url,
                    hasBody: !!fetched?.body,
                });
            }

            if (fetched?.ok && (fetched.url || fetched.storageKey || fetched.body)) {
                return {
                    ok: true,
                    url: fetched.url,
                    storageKey: fetched.storageKey,
                    data: fetched.body,
                };
            }

            if (fetched && !fetched.ok) {
                return {
                    ok: false,
                    status: fetched.status,
                    message: fetched.message || 'not found',
                };
            }

            return { ok: false, message: 'not found' };
        } finally {
            pendingDownloads.delete(blobCoalesceKey);
        }
    })();
}
