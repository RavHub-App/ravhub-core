const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

async function uploadPlugin() {
    const email = 'admin@ravhub.app';
    const password = '12341234';
    const baseUrl = 'http://localhost:3001';

    try {
        console.log('Getting CSRF token...');
        const csrfRes = await axios.get(`${baseUrl}/api/auth/csrf`);
        const csrfToken = csrfRes.data.csrfToken;
        const cookies = csrfRes.headers['set-cookie'];

        console.log('Logging in...');
        const loginRes = await axios.post(`${baseUrl}/api/auth/callback/credentials`,
            new URLSearchParams({
                csrfToken,
                email,
                password,
                json: 'true'
            }).toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': cookies.join('; ')
                },
                maxRedirects: 0,
                validateStatus: (status) => status >= 200 && status < 400
            }
        );

        const sessionCookies = loginRes.headers['set-cookie'];
        if (!sessionCookies) {
            throw new Error('Failed to get session cookies. Check credentials.');
        }

        console.log('Uploading plugin...');
        const pluginPath = path.join(__dirname, '../packages/maven-plugin/maven-1.2.0.tgz');
        if (!fs.existsSync(pluginPath)) {
            throw new Error(`Plugin file not found: ${pluginPath}`);
        }

        const form = new FormData();
        form.append('file', fs.createReadStream(pluginPath));
        form.append('name', 'Maven');
        form.append('version', '1.2.0');
        form.append('description', 'Official Maven plugin for RavHub. Supports proxying and local storage.');
        form.append('isPublic', 'false');
        form.append('minLicenseTier', 'pro');

        const uploadRes = await axios.post(`${baseUrl}/api/admin/plugins`, form, {
            headers: {
                ...form.getHeaders(),
                'Cookie': sessionCookies.join('; ')
            }
        });

        console.log('Upload successful:', uploadRes.data);
    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
        process.exit(1);
    }
}

uploadPlugin();
