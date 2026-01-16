
const API_URL = 'http://localhost:5173';
const REPO = 'npm-proxy';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyZTQ5NDc3Ni02YWNhLTQ0OGQtODI1Yy01YjlhNGZjZGQzYTUiLCJ1c2VybmFtZSI6Im1hbnVhbC1hZG1pbiIsImlhdCI6MTc2Njc1Mzk1OSwiZXhwIjoxNzY2NzU3NTU5fQ.DX3nPyMviEC1L09DoIbHLVFiEc2iLRZDod2895zBarw';

async function test() {
    console.log('Fetching lodash (1st time)...');
    const res1 = await fetch(`${API_URL}/repository/${REPO}/lodash`, {
        headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    console.log('Status:', res1.status);
    console.log('X-Proxy-Cache:', res1.headers.get('x-proxy-cache'));

    console.log('\nWaiting 65 seconds for in-memory cache to expire...');
    await new Promise(resolve => setTimeout(resolve, 65000));

    console.log('\nFetching lodash (2nd time)...');
    const res2 = await fetch(`${API_URL}/repository/${REPO}/lodash`, {
        headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    console.log('Status:', res2.status);
    console.log('X-Proxy-Cache:', res2.headers.get('x-proxy-cache'));
}

test().catch(console.error);
