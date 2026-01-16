
import { S3StorageAdapter } from '../../src/storage/s3-storage.adapter';
import { Readable } from 'stream';

async function run() {
    console.log('--- Starting Local S3 Integration Test ---');

    // Configuration for local MinIO
    const config = {
        bucket: 'test-bucket',
        accessKeyId: 'admin',
        secretAccessKey: 'password',
        endpoint: 'http://localhost:9900',
        region: 'us-east-1',
        forcePathStyle: true
    };

    console.log('Connecting to S3 with config:', JSON.stringify(config, null, 2));

    const adapter = new S3StorageAdapter(config);
    const testKey = 'integration-test/hello.txt';
    const testContent = 'Hello from local S3 integration test!';

    try {
        // 1. Save
        console.log(`\n1. Saving file to ${testKey}...`);
        const saveResult = await adapter.save(testKey, testContent);
        if (!saveResult.ok) {
            throw new Error(`Save failed: ${saveResult.message}`);
        }
        console.log('   Save successful!', saveResult.path);

        // 2. Exists
        console.log(`\n2. Checking if file exists...`);
        const exists = await adapter.exists(testKey);
        console.log(`   Exists: ${exists}`);
        if (!exists) throw new Error('File should exist but does not.');

        // 3. Get
        console.log(`\n3. Reading file content...`);
        const contentBuffer = await adapter.get(testKey);
        const content = contentBuffer?.toString();
        console.log(`   Content: "${content}"`);
        if (content !== testContent) throw new Error('Content mismatch!');

        // 4. List
        console.log(`\n4. Listing files in "integration-test/"...`);
        const list = await adapter.list('integration-test/');
        console.log('   Files found:', list);
        if (!list.includes(testKey)) throw new Error('List did not include the test file.');

        // 5. Stream
        console.log(`\n5. Testing stream read...`);
        const streamRes = await adapter.getStream(testKey);
        let streamContent = '';
        for await (const chunk of streamRes.stream) {
            streamContent += chunk.toString();
        }
        console.log('   Stream content read successfully.');
        if (streamContent !== testContent) throw new Error('Stream content mismatch!');

        console.log('\n--- Test Passed Successfully! ---');

    } catch (err: any) {
        console.error('\n!!! Test Failed !!!');
        console.error(err);
        process.exit(1);
    }
}

run();
