const fs = require('fs');

async function testDownload() {
    const url = 'https://crates.io/api/v1/crates/serde/1.0.197/download';
    console.log(`Fetching ${url}...`);

    try {
        const response = await fetch(url, {
            redirect: 'follow',
            headers: {
                'User-Agent': 'RavHub-Proxy/1.0'
            }
        });

        console.log('Status:', response.status);
        console.log('Headers:', Object.fromEntries(response.headers));

        const buffer = await response.arrayBuffer();
        console.log('Body size:', buffer.byteLength);

        if (buffer.byteLength > 0) {
            console.log('Success: Got content');
        } else {
            console.log('Failure: Empty content');
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

testDownload();
