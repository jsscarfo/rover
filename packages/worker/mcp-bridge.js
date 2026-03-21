#!/usr/bin/env node
/**
 * mcp-bridge.js — stdio→HTTP bridge for Laureline Code MCP service.
 *
 * Claude Code passes MCP JSON-RPC over stdio. This bridge reads each
 * newline-delimited JSON request, POSTs it to the Laureline Index HTTP
 * service, and writes the JSON response back to stdout.
 *
 * Usage (in mcp.json):
 *   {
 *     "mcpServers": {
 *       "laureline-code": {
 *         "command": "node",
 *         "args": ["/path/to/mcp-bridge.js"],
 *         "env": { "LAURELINE_INDEX_URL": "http://laureline-index.railway.internal:8080" }
 *       }
 *     }
 *   }
 */
'use strict';

const http = require('http');
const { URL } = require('url');
const readline = require('readline');

const BASE_URL = process.env.LAURELINE_INDEX_URL;
const AUTH_TOKEN = process.env.ROVER_WEB_TOKEN;

if (!BASE_URL) {
  process.stderr.write('[mcp-bridge] ERROR: LAURELINE_INDEX_URL is not set\n');
  process.exit(1);
}

const rpcUrl = new URL('/rpc', BASE_URL);
process.stderr.write(`[mcp-bridge] Connected to ${rpcUrl.href}\n`);

/**
 * Post a JSON-RPC request to the HTTP service and return the response text.
 * @param {string} body - Raw JSON string
 * @returns {Promise<string>} - Raw JSON response string
 */
function postRpc(body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, 'utf8');
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': buf.length,
    };
    if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;

    const req = http.request(
      {
        hostname: rpcUrl.hostname,
        port: rpcUrl.port || 80,
        path: rpcUrl.pathname,
        method: 'POST',
        headers,
        timeout: 60_000, // 60s — search queries are fast, reindex could be slow
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data.trim()));
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

// ── Stdio loop ────────────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  if (!line.trim()) return;

  try {
    const response = await postRpc(line.trim());
    if (response) {
      process.stdout.write(response + '\n');
    }
  } catch (err) {
    process.stderr.write(`[mcp-bridge] Error: ${err.message}\n`);

    // Extract request ID if possible to send a proper error response
    let requestId = null;
    try {
      const parsed = JSON.parse(line);
      requestId = parsed.id ?? null;
    } catch { /* ignore */ }

    const errResponse = JSON.stringify({
      jsonrpc: '2.0',
      id: requestId,
      error: { code: -32603, message: `Bridge error: ${err.message}` },
    });
    process.stdout.write(errResponse + '\n');
  }
});

rl.on('close', () => {
  process.stderr.write('[mcp-bridge] stdin closed, exiting\n');
  process.exit(0);
});
