const http = require('http');

const url = 'http://host.docker.internal:3001/api/plugins/free-plugin/1.0.0/download';

console.log(`Testing connection to ${url}`);

http.get(url, (res) => {
    console.log(`Status Code: ${res.statusCode}`);
    console.log('Headers:', res.headers);
    res.resume();
}).on('error', (e) => {
    console.error(`Got error: ${e.message}`);
});
