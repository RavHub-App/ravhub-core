
import { AzureEnterpriseAdapter } from '../../src/storage/adapters/azure-enterprise.adapter';
import { GcsEnterpriseAdapter } from '../../src/storage/adapters/gcs-enterprise.adapter';
import { StorageAdapter } from '../../src/storage/storage.interface';
import { ContainerClient } from '@azure/storage-blob';
import axios from 'axios';

async function testAdapter(name: string, adapter: StorageAdapter, setup?: () => Promise<void>) {
    console.log(`\n--- Testing ${name} ---`);

    if (setup) {
        console.log('Running setup...');
        try {
            await setup();
        } catch (err: any) {
            console.warn('Setup warning (might already exist):', err.message);
        }
    }

    const key = `integration-test/${name}-test.txt`;
    const content = `Hello from ${name} integration test!`;

    try {
        // 1. Save
        console.log(`1. Saving file to ${key}...`);
        const saveRes = await adapter.save(key, content);
        if (!saveRes.ok) throw new Error(`Save failed: ${saveRes.message}`);
        console.log('   Save successful!', saveRes.path);

        // 2. Exists
        console.log(`2. Checking exists...`);
        const exists = await adapter.exists(key);
        console.log(`   Exists: ${exists}`);
        if (!exists) throw new Error('File should exist');

        // 3. Get URL (just print it, don't validate reachability as these are emulators)
        const url = await adapter.getUrl(key);
        console.log(`   URL: ${url}`);

        // 4. Stream Read
        console.log(`3. Reading stream...`);
        if (!adapter.getStream) throw new Error('getStream not supported');
        const streamRes = await adapter.getStream(key);
        let readContent = '';
        for await (const chunk of streamRes.stream) {
            readContent += chunk.toString();
        }
        console.log(`   Content: "${readContent}"`);
        if (readContent !== content) throw new Error('Content mismatch');

        console.log(`✓ ${name} Passed`);
    } catch (err: any) {
        console.error(`!!! ${name} Failed !!!`, err);
        process.exit(1);
    }
}

async function run() {
    // Test Azure (Azurite)
    // Default Azurite connection string
    const azConnStr = "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;";
    const azContainer = "test-container";

    const azureAdapter = new AzureEnterpriseAdapter({
        connectionString: azConnStr,
        container: azContainer
    });

    await testAdapter('Azure', azureAdapter, async () => {
        // Create container manually via client since adapter might expect it
        const client = new ContainerClient(azConnStr, azContainer);
        await client.createIfNotExists();
    });

    // Test GCS (fake-gcs-server)
    // fake-gcs-server doesn't simulate authentication, so we can pass dummy creds
    // but we need to tell the library to use the local API endpoint
    process.env.STORAGE_EMULATOR_HOST = 'http://localhost:4443';

    const gcsAdapter = new GcsEnterpriseAdapter({
        bucket: 'test-bucket',
        projectId: 'test-project',
        // The emulator handles auth laxly, or we rely on STORAGE_EMULATOR_HOST
    });

    await testAdapter('GCS', gcsAdapter, async () => {
        // Create bucket via API call to fake-gcs-server
        await axios.post('http://localhost:4443/storage/v1/b', {
            name: 'test-bucket'
        });
    });

    console.log('\nAll Enterprise Tests Passed!');
}

run();
