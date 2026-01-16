import { PluginContext, Repository } from '../utils/types';
import * as cheerio from 'cheerio';

export function initMetadata(context: PluginContext) {
    const getProxyUrl = (repo: Repository) => {
        const host = process.env.API_HOST || 'localhost:3000';
        const proto = process.env.API_PROTOCOL || 'http';
        return `${proto}://${host}/repository/${repo.name}`;
    };

    const processSimpleIndex = (repo: Repository, html: string) => {
        console.log(`[PyPI] Processing simple index for ${repo.name}`);
        const $ = cheerio.load(html);
        const proxyUrl = getProxyUrl(repo);

        $('a').each((_, el) => {
            const href = $(el).attr('href');
            if (href) {
                // PyPI simple index links are usually absolute or relative to the simple index root.
                // They often contain hashes like #sha256=...

                // If it's an absolute URL to files.pythonhosted.org or similar, we want to proxy it.
                // We can use a similar strategy to NuGet: /repository/:id/pypi-proxy/<encoded-url>

                // Or, if we want to be cleaner, we can rewrite to /repository/:id/files/<hash>/<filename>
                // But that requires us to know how to map back.

                // The "pypi-proxy" strategy is robust.

                // Check if it's an external link
                if (href.startsWith('http') || href.startsWith('/')) {
                    const fullUrl = href.startsWith('/') ? `https:${href}` : href;
                    const encoded = encodeURIComponent(fullUrl);
                    $(el).attr('href', `${proxyUrl}/pypi-proxy/${encoded}`);
                } else {
                    // Relative link. 
                    // If it's relative, the client will resolve it against our proxy index URL.
                    // e.g. ../../packages/../file.whl
                    // Our index is at /repository/:id/simple/:package/
                    // So ../../ resolves to /repository/:id/

                    // If the upstream uses relative links, they are relative to the upstream simple index.
                    // We need to make sure they resolve to something we can handle.

                    // If we just leave them, they might resolve to /repository/:id/packages/...
                    // If we handle /repository/:id/packages/... in our proxyFetch, we are good.

                    // But often PyPI links are absolute.
                    // Let's assume absolute for now as that's what pypi.org uses.
                }

                // Preserve data-requires-python and other attributes (cheerio does this by default)
            }
        });

        return $.html();
    };

    return { processSimpleIndex };
}
