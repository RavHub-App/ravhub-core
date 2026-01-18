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


const API_URL = 'http://localhost:5173';
const REPO = 'npm-proxy';

async function test() {
    console.log('Fetching react metadata (1st time)...');
    const res1 = await fetch(`${API_URL}/repository/${REPO}/react`);
    console.log('Status:', res1.status);
    console.log('Headers:', JSON.stringify(Object.fromEntries(res1.headers.entries()), null, 2));

    console.log('\nFetching react metadata (2nd time)...');
    const res2 = await fetch(`${API_URL}/repository/${REPO}/react`);
    console.log('Status:', res2.status);
    console.log('X-Proxy-Cache:', res2.headers.get('x-proxy-cache'));

    const json = await res2.json();
    const latest = json['dist-tags'].latest;
    const tarballUrl = json.versions[latest].dist.tarball;
    console.log('\nLatest version:', latest);
    console.log('Tarball URL:', tarballUrl);

    console.log('\nFetching tarball (1st time)...');
    const res3 = await fetch(tarballUrl);
    console.log('Status:', res3.status);
    console.log('X-Proxy-Cache:', res3.headers.get('x-proxy-cache'));

    console.log('\nFetching tarball (2nd time)...');
    const res4 = await fetch(tarballUrl);
    console.log('Status:', res4.status);
    console.log('X-Proxy-Cache:', res4.headers.get('x-proxy-cache'));
}

test().catch(console.error);
