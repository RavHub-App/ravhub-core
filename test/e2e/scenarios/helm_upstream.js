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

const http = require("http");
const fs = require("fs");
const path = require("path");

const USER = process.env.UP_USER || "up-user";
const PASS = process.env.UP_PASS || "up-pass";
const PORT = parseInt(process.env.UP_PORT || "18080", 10);
const chartPath = "/tmp/e2e-helm-upstream/e2e-chart-0.1.0.tgz";

process.title = "e2e-helm-basic-upstream";

// Global error handlers
process.on('uncaughtException', (err) => {
    console.error('[UPSTREAM] Uncaught Exception:', err);
});

function unauthorized(res) {
    // Connection: close helps prevent client (API) confusion on 401
    res.writeHead(401, { "WWW-Authenticate": "Basic realm=\"up\"", "Connection": "close" });
    res.end("Unauthorized");
}

const server = http.createServer((req, res) => {
    console.log(`[UPSTREAM] Received ${req.method} ${req.url}`);
    const auth = req.headers.authorization || "";

    // Log auth prefix for debugging
    // console.log(`[UPSTREAM] Auth header prefix: ${auth.substring(0, 10)}...`);

    if (!auth.startsWith("Basic ")) {
        console.log("[UPSTREAM] No Basic auth header, sending 401");
        return unauthorized(res);
    }
    const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    const u = idx >= 0 ? decoded.slice(0, idx) : decoded;
    const p = idx >= 0 ? decoded.slice(idx + 1) : "";
    if (u !== USER || p !== PASS) {
        console.log("[UPSTREAM] Invalid credentials, sending 401");
        return unauthorized(res);
    }

    if (req.url === "/index.yaml" || req.url === "/index.yml") {
        console.log("[UPSTREAM] Serving index.yaml");
        const now = new Date().toISOString();
        const body = `apiVersion: v1
entries:
  e2e-chart:
    - apiVersion: v2
      name: e2e-chart
      version: 0.1.0
      urls:
        - e2e-chart-0.1.0.tgz
      created: "${now}"
`;
        res.writeHead(200, { "Content-Type": "application/x-yaml" });
        return res.end(body);
    }

    if (req.url === "/e2e-chart-0.1.0.tgz" || req.url.endsWith(".tgz")) {
        console.log(`[UPSTREAM] Serving chart: ${req.url}`);
        try {
            if (fs.existsSync(chartPath)) {
                const buf = fs.readFileSync(chartPath);
                res.writeHead(200, { "Content-Type": "application/gzip" });
                return res.end(buf);
            } else {
                console.log("[UPSTREAM] Chart file not found");
                res.writeHead(404);
                return res.end("Not found");
            }
        } catch (e) {
            console.error("[UPSTREAM] Error reading chart:", e);
            res.writeHead(500);
            return res.end("Error");
        }
    }

    res.writeHead(404);
    res.end("Not found");
});

server.on('clientError', (err, socket) => {
    // console.error('[UPSTREAM] clientError', err);
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("e2e-helm-basic-upstream listening on", PORT);
});
