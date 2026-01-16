
export interface NpmVersion {
    name: string;
    version: string;
    dist?: {
        tarball: string;
        shasum: string;
        integrity?: string;
    };
    [key: string]: any;
}

export interface NpmMetadata {
    _id: string;
    name: string;
    description?: string;
    'dist-tags': Record<string, string>;
    versions: Record<string, NpmVersion>;
    readme?: string;
    _attachments?: Record<string, { content_type?: string; data: string; length?: number }>;
    [key: string]: any;
}

export function mergeMetadata(existing: NpmMetadata, incoming: NpmMetadata): NpmMetadata {
    const merged = { ...existing };

    // Update basic info if provided
    if (incoming.description) merged.description = incoming.description;
    if (incoming.readme) merged.readme = incoming.readme;

    // Merge versions
    if (incoming.versions) {
        merged.versions = { ...merged.versions, ...incoming.versions };
    }

    // Merge dist-tags
    if (incoming['dist-tags']) {
        merged['dist-tags'] = { ...merged['dist-tags'], ...incoming['dist-tags'] };
    }

    // Attachments are usually handled separately or stripped before storage if we store tarballs separately
    // But for metadata merging, we might want to keep them if we are storing the full document
    // In a real registry, attachments are often stripped from the metadata document stored in DB
    // and tarballs are stored in blob storage.

    return merged;
}

export function createInitialMetadata(name: string): NpmMetadata {
    return {
        _id: name,
        name: name,
        'dist-tags': {},
        versions: {},
    };
}
