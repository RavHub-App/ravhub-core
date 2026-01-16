const API_URL = 'http://localhost:5173';
const REPO = 'npm-proxy';
const PACKAGE = 'lodash';

async function testRevalidation() {
    const url = `${API_URL}/repository/${REPO}/${PACKAGE}`;

    console.log(`--- Testing Revalidation for ${PACKAGE} ---`);

    try {
        // 1. Fetch metadata to get a tarball URL
        console.log('1. Fetching metadata...');
        const metaRes = await fetch(url);
        const metaData = await metaRes.json();
        const latestVersion = metaData['dist-tags'].latest;
        const tarballUrl = metaData.versions[latestVersion].dist.tarball;
        console.log(`Latest version: ${latestVersion}`);
        console.log(`Tarball URL: ${tarballUrl}`);

        // 2. First download (MISS)
        console.log('\n2. First download (should be MISS)...');
        const res1 = await fetch(tarballUrl);
        console.log('Status:', res1.status);
        console.log('X-Proxy-Cache:', res1.headers.get('x-proxy-cache'));

        // 3. Second download (HIT with Revalidation)
        console.log('\n3. Second download (should be HIT with revalidation logs in API)...');
        const res2 = await fetch(tarballUrl);
        console.log('Status:', res2.status);
        console.log('X-Proxy-Cache:', res2.headers.get('x-proxy-cache'));

        console.log('\nCheck API logs for: "[NPM] Revalidating cached tarball"');

    } catch (err) {
        console.error('Error:', err.message);
    }
}

testRevalidation();
