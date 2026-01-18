/*
 * Copyright (C) 2026 RavHub Team
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

const REPO = 'pypi-proxy';
const API_URL = 'http://localhost:5173';

async function testPyPICache() {
    const url = `${API_URL}/repository/${REPO}/requests/`;

    console.log('Fetching PyPI simple index (1st time)...');
    try {
        const res1 = await fetch(url);
        console.log('Status:', res1.status);
        console.log('X-Proxy-Cache:', res1.headers.get('x-proxy-cache'));

        const data1 = await res1.text();
        // Check if URLs are rewritten
        const hasRewritten = data1.includes('/pypi-proxy/');
        console.log('Has rewritten URLs:', hasRewritten);
        if (hasRewritten) {
            const match = data1.match(/href="([^"]+\/pypi-proxy\/[^"]+)"/);
            if (match) {
                console.log('Sample rewritten URL:', match[1]);
            }
        }

        console.log('\nFetching PyPI simple index (2nd time)...');
        const res2 = await fetch(url);
        console.log('Status:', res2.status);
        console.log('X-Proxy-Cache:', res2.headers.get('x-proxy-cache'));

    } catch (err) {
        console.error('Error:', err.message);
    }
}

testPyPICache();
