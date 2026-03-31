/*
 * Copyright (C) 2026 Rubén Santibáñez Acosta
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

import { initStorage } from 'src/modules/plugins/impl/rust-plugin/storage/storage';
import * as keyUtils from 'src/modules/plugins/impl/rust-plugin/utils/key-utils';

jest.mock('src/modules/plugins/impl/rust-plugin/utils/key-utils');

const mockProxyFetch = jest.fn();

jest.mock('src/plugins-core/proxy-helper', () => ({
    __esModule: true,
    default: (...args: unknown[]) => mockProxyFetch(...args),
}));

describe('RustPlugin group proxy download', () => {
    beforeEach(() => {
        (keyUtils.buildKey as jest.Mock).mockImplementation((...args) =>
            args.join('/'),
        );
        mockProxyFetch.mockReset();
    });

    it('normalizes crate/version before delegating a group download to a proxy member', async () => {
        const proxyRepo = {
            id: 'proxy-1',
            name: 'rust-proxy',
            type: 'proxy',
            config: {
                url: 'http://localhost:3000/repository/rust-hosted',
            },
        };
        const groupRepo = {
            id: 'group-1',
            name: 'rust-group-read',
            type: 'group',
            config: {
                members: ['proxy-1'],
            },
        };
        const context = {
            storage: {
                get: jest.fn().mockResolvedValue(null),
                save: jest.fn().mockResolvedValue({ ok: true }),
                exists: jest.fn().mockResolvedValue(false),
            },
            getRepo: jest.fn().mockResolvedValue(proxyRepo),
            indexArtifact: jest.fn(),
        };

        mockProxyFetch.mockResolvedValue({
            ok: true,
            body: Buffer.from('hosted-content'),
        });

        const storageMethods = initStorage(context as any);
        const result = await storageMethods.download(
            groupRepo as any,
            'my-crate/0.1.0',
        );

        expect(result.ok).toBe(true);
        expect(result.data?.toString()).toBe('hosted-content');
        expect(mockProxyFetch).toHaveBeenCalledWith(
            proxyRepo,
            'http://localhost:3000/repository/rust-hosted/my-crate/0.1.0',
        );
    });
});
