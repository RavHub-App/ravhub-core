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

import { createPackageBaseResolver } from 'src/modules/plugins/impl/nuget-plugin/storage/download-feed-support';

describe('NuGet package base resolver', () => {
    beforeEach(() => {
        process.env.API_HOST = 'localhost:3000';
        process.env.API_PROTOCOL = 'http';
    });

    it('normalizes rewritten local v3-proxy package base URLs to a relative proxy path', async () => {
        const proxyFetch = jest.fn().mockResolvedValue({
            status: 200,
            body: {
                resources: [
                    {
                        '@type': 'PackageBaseAddress/3.0.0',
                        '@id':
                            'http://localhost:3000/repository/nuget-proxy/v3-proxy/https%3A%2F%2Fapi.nuget.org%2Fv3-flatcontainer%2F',
                    },
                ],
            },
        });

        const resolvePackageBase = createPackageBaseResolver(proxyFetch);
        const result = await resolvePackageBase({
            id: 'p1',
            name: 'nuget-proxy',
            type: 'proxy',
            manager: 'nuget',
        } as any);

        expect(result).toBe(
            'v3-proxy/https%3A%2F%2Fapi.nuget.org%2Fv3-flatcontainer%2F',
        );
        expect(proxyFetch).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'nuget-proxy' }),
            'index.json',
        );
    });
});
