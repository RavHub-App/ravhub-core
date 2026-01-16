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
