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

const http = require('http');

console.log('PyPI Mock Upstream starting...');

const server = http.createServer((req, res) => {
    const auth = req.headers['authorization'];
    console.log(`[PyPI Mock] Request: ${req.method} ${req.url} Auth: ${auth}`);

    if (req.url === '/auth-check') {
        if (auth === 'Basic dXAtdXNlcjp1cC1wYXNz') { // up-user:up-pass
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, message: 'Authenticated' }));
        } else {
            res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="PyPI"' });
            res.end(JSON.stringify({ ok: false, message: 'Unauthorized' }));
        }
        return;
    }

    // Simple PyPI simple index mock
    if (req.url === '/simple/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><a href="test-pkg/">test-pkg</a></body></html>');
        return;
    }

    if (req.url === '/simple/test-pkg/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><a href="../../packages/test-pkg-1.0.0.tar.gz">test-pkg-1.0.0.tar.gz</a></body></html>');
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

const port = 18082;
server.listen(port, '0.0.0.0', () => {
    console.log(`PyPI Mock Upstream running on port ${port}`);
});
