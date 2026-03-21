# Rover Constellation (Worker Pool Architecture)

## Overview
Rover now supports a distributed **Constellation** architecture. Instead of running tasks locally on the web coordinator (which is constrained by free-tier UI timeouts or restrictive serverless platforms), tasks are dispatched to an array of dedicated, persistent **Worker Nodes**. 

This distributed model ensures that Agent executions—which may take tens of minutes and spawn expensive sub-processes like Playwright and LanceDB—can run reliably without crashing the web service.

## Components

### 1. Web Coordinator (`packages/web`)
The web package acts as the presentation layer and router. 
- Serves the Single Page Application (SPA) dashboard.
- Maintains a list of `WORKERS` via environment variables (e.g. `WORKER_1_URL`, `WORKER_2_URL`).
- Aggregates status from all workers across the network to present a unified "Constellation Status" on the navbar.
- Dispatches new tasks to the first available idle worker using a race-condition safe `fetch` retry loop (`dispatchToWorker`).
- When inspecting a task (`GET /api/tasks/:id` / `logs` / `diff` / `stop` / `delete`), the coordinator proxies the request to the specific worker that owns that task memory.

### 2. Standalone Workers (`packages/worker`)
Workers are simple, stateless Express servers that execute Rover tasks (`runTask()`).
- Workers hold active and completed tasks in an in-memory `Map()`.
- Expose `/task` endpoints to accept, inspect, stop, and delete tasks.
- Dynamically clone remote repositories using `GITHUB_TOKEN`.
- **MCP Injection**: Workers automatically generate `.mcp.json` files and proxy the standard `stdio` interface over to decoupled remote MCP servers (like the Laureline-Code HTTP/SSE wrapper) using the `mcp-bridge.js` proxy pattern.

## Deployment Profile (Railway)
- The **Coordinator** is deployed as a public-facing Railway service.
- The **Workers** are deployed as private horizontal Railway services (`rover-worker-1` .. `rover-worker-5`).
- **Dependencies**: Railpack is utilized via `railpack.json` to install required binary dependencies (`git`, `curl`, `ca-certificates`) during the deployment phase to ensure Claude Code and the underlying task executors function properly.
- **Environment**: Workers authenticate dashboard requests via `ROVER_WEB_TOKEN`. They authenticate against repos using `GITHUB_TOKEN` and make LLM calls using `ANTHROPIC_API_KEY`.

## Web Client Features
- **Task History**: The client aggregates historical memory mapped tasks across all endpoints.
- **Task Deletion**: Tasks can be explicitly wiped from a worker's memory map using the UI.
- **Task Relaunch**: The Restart button automatically snapshots the old task's payload and re-submits it into the work queue for the next available worker.
- **Worker Drawer**: Clicking a busy worker pill opens a live drawer streaming the executing task's stdout.
