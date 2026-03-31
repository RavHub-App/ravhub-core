import type { PluginContext, Repository } from '../utils/types';
import * as proxyHelperModule from '../../../../../plugins-core/proxy-helper';

type ComposerProxyConfig = {
    cacheEnabled?: boolean;
    cacheMaxAgeDays?: number;
};

export type ProxyHelperResponse = {
    ok: boolean;
    body?: Buffer;
    headers?: Record<string, string | undefined>;
    skipCache?: boolean;
    data?: Buffer;
    message?: string;
};

export type ProxyHelper = (
    repo: Repository,
    url: string,
    options?: { method?: string; timeoutMs?: number },
) => Promise<ProxyHelperResponse>;

type ComposerStorage = PluginContext['storage'];

export function resolveComposerProxyHelper(): ProxyHelper | null {
    try {
        const directCandidate = proxyHelperModule as unknown;
        const defaultCandidate = (proxyHelperModule as { default?: unknown })
            .default;
        const nestedDefaultCandidate =
            defaultCandidate && typeof defaultCandidate === 'object'
                ? (defaultCandidate as { default?: unknown }).default
                : undefined;

        if (typeof directCandidate === 'function') {
            return directCandidate as ProxyHelper;
        }
        if (typeof defaultCandidate === 'function') {
            return defaultCandidate as ProxyHelper;
        }
        if (typeof nestedDefaultCandidate === 'function') {
            return nestedDefaultCandidate as ProxyHelper;
        }
        throw new Error('proxy helper export is not callable');
    } catch (error) {
        console.warn(`[Composer] Proxy helper unavailable: ${String(error)}`);
        return null;
    }
}

export async function readComposerProxyCache(
    storage: ComposerStorage,
    helper: ProxyHelper | null,
    repo: Repository,
    url: string,
    name: string,
    cleanVersion: string,
    keyId: string,
    cacheEnabled: boolean,
) {
    if (!cacheEnabled) {
        return { cached: null, skipCacheCheck: false };
    }

    try {
        const existing = await storage.get(keyId).catch(() => null);
        if (!existing) {
            return { cached: null, skipCacheCheck: false };
        }

        if (!helper) {
            return { cached: null, skipCacheCheck: false };
        }

        try {
            const headResponse = await helper(repo, url, {
                method: 'HEAD',
                timeoutMs: 5000,
            });
            if (headResponse.ok && headResponse.headers) {
                const contentLength = headResponse.headers['content-length'];
                if (contentLength && parseInt(contentLength, 10) !== existing.length) {
                    return { cached: null, skipCacheCheck: true };
                }

                return {
                    cached: {
                        ok: true,
                        data: existing,
                        skipCache: true,
                    } satisfies ProxyHelperResponse,
                    skipCacheCheck: false,
                };
            }
        } catch (error) {
            console.warn(
                `[Composer] HEAD revalidation failed for ${name}:${cleanVersion}. Serving cache. ${String(error)}`,
            );
            return {
                cached: {
                    ok: true,
                    data: existing,
                    skipCache: true,
                } satisfies ProxyHelperResponse,
                skipCacheCheck: false,
            };
        }
    } catch (error) {
        console.warn(
            `[Composer] Failed to read proxy cache for ${name}:${cleanVersion}: ${String(error)}`,
        );
    }

    return { cached: null, skipCacheCheck: false };
}

export async function persistComposerProxyPackage(
    context: PluginContext,
    storage: ComposerStorage,
    repo: Repository,
    proxyConfig: ComposerProxyConfig,
    keyId: string,
    name: string,
    version: string,
    body: Buffer,
) {
    const cacheEnabled = proxyConfig.cacheEnabled !== false;
    const cacheMaxAgeDays = proxyConfig.cacheMaxAgeDays ?? 7;
    if (!(cacheEnabled && cacheMaxAgeDays > 0)) {
        return;
    }

    try {
        await storage.save(keyId, body);
        if (context.indexArtifact) {
            await context.indexArtifact(repo, {
                ok: true,
                id: `${name}:${version}`,
                metadata: {
                    name,
                    version,
                    storageKey: keyId,
                    size: body.length,
                    filename: `${name.split('/').pop()}-${version}.zip`,
                },
            });
        }
    } catch (error) {
        console.warn(
            `[Composer] Failed to persist proxy package ${name}:${version}: ${String(error)}`,
        );
    }
}
