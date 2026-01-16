
const API_URL = 'http://localhost:5173';
const REPO = 'nuget-proxy';

async function test() {
    console.log('Fetching NuGet service index (1st time)...');
    const res1 = await fetch(`${API_URL}/repository/${REPO}/index.json`);
    console.log('Status:', res1.status);
    console.log('X-Proxy-Cache:', res1.headers.get('x-proxy-cache'));

    console.log('\nFetching NuGet service index (2nd time)...');
    const res2 = await fetch(`${API_URL}/repository/${REPO}/index.json`);
    console.log('Status:', res2.status);
    console.log('X-Proxy-Cache:', res2.headers.get('x-proxy-cache'));

    const json = await res2.json();
    console.log('\nService Index Resources (first 3):');
    console.log(JSON.stringify(json.resources.slice(0, 3), null, 2));
}

test().catch(console.error);
