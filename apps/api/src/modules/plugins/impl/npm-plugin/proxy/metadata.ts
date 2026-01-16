import { PluginContext, Repository } from '../utils/types';

export function initMetadata(context: PluginContext) {
    const getProxyUrl = (repo: Repository) => {
        const host = process.env.API_HOST || 'localhost:3000';
        const proto = process.env.API_PROTOCOL || 'http';
        return `${proto}://${host}/repository/${repo.name}`;
    };

    const processMetadata = (repo: Repository, content: any, overrideProxyUrl?: string) => {
        let json: any;
        try {
            if (Buffer.isBuffer(content)) {
                json = JSON.parse(content.toString());
            } else if (typeof content === 'string') {
                json = JSON.parse(content);
            } else {
                json = content;
            }
        } catch (e) {
            console.error('[NPM] Failed to parse metadata JSON:', e);
            return content;
        }

        const proxyUrl = overrideProxyUrl || getProxyUrl(repo);
        const upstreamUrl = repo.config?.proxyUrl?.replace(/\/$/, '') || 'https://registry.npmjs.org';
        const shouldRewrite = repo.config?.rewriteTarballs !== false;

        if (!shouldRewrite) {
            return json;
        }

        if (json.versions) {
            for (const version of Object.values(json.versions) as any[]) {
                if (version.dist && version.dist.tarball) {
                    const tarball = version.dist.tarball;
                    // If tarball starts with upstreamUrl, replace it
                    if (tarball.startsWith(upstreamUrl)) {
                        version.dist.tarball = tarball.replace(upstreamUrl, proxyUrl);
                    } else if (tarball.includes('/-/') && !tarball.startsWith(proxyUrl)) {
                        // Aggressive rewrite for any tarball URL that looks like an NPM tarball
                        // but isn't already pointing to us.
                        try {
                            const u = new URL(tarball);
                            let path = u.pathname.startsWith('/') ? u.pathname.slice(1) : u.pathname;

                            // If path already contains repository/:name, strip it to avoid double prefixing
                            const repoPrefix = `repository/${repo.name}/`;
                            if (path.startsWith(repoPrefix)) {
                                path = path.slice(repoPrefix.length);
                            }

                            version.dist.tarball = `${proxyUrl}/${path}`;
                        } catch (e) { }
                    }
                }
            }
        }

        return json;
    };

    return { processMetadata };
}
