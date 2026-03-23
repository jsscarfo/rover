# Rover V2 Usage Guide

Rover V2 introduces a Git-centric architecture with a pipeline workflow for AI agents. This guide explains how to use the new features.

## Initialization

To start using Rover V2 on a project, you need to initialize the `.rover/` directory structure. This directory will store the Work Breakdown Structure (WBS), task sessions, and agent memories.

```bash
rover init-rover
```

This command creates:
- `.rover/manifest.json`: Project configuration and budget limits.
- `.rover/wbs.json`: The Work Breakdown Structure.
- `.rover/sessions/`: Directory for active and completed task sessions.
- `.rover/memories/`: Directory for persistent agent knowledge.

## Adding Tasks

Tasks are now managed through the WBS. You can add tasks by editing `.rover/wbs.json` directly or using the dashboard.

Example WBS module:
```json
{
  "id": "auth-module",
  "title": "Authentication Module",
  "phase": "planning",
  "status": "pending",
  "phases": {
    "planning": { "status": "pending" }
  }
}
```

## Monitoring Progress

The Rover Dashboard provides real-time visibility into the pipeline:

1. **Tree View**: Shows the hierarchical structure of the WBS, including task phases and progress.
2. **Kanban View**: Displays tasks moving through the pipeline phases (Backlog, Planning, Design, Implement, Test, Deploy).
3. **Task Detail**: Click on any task to view its phase history, deliverables, token usage, and cost.

## Pipeline Workflow

The Director process automatically orchestrates tasks through five phases:

1. **Planning**: Decomposes the feature request into subtasks.
2. **Design**: Creates technical specifications and architecture.
3. **Implement**: Writes the code (using Claude Code).
4. **Test**: Writes and executes tests.
5. **Deploy**: Prepares deployment and rollback plans.

When a phase completes, the worker commits the session state to `.rover/sessions/{id}.json`. The Director detects this, updates the WBS, and spawns the next phase.

## Budget Configuration

You can configure budget limits in `.rover/manifest.json` to control AI agent costs:

```json
{
  "budget": {
    "maxTokens": 10000000,
    "maxCostUSD": 500,
    "warningAt": 0.5
  }
}
```

The Director will pause tasks if the `maxCostUSD` is exceeded and log warnings when the `warningAt` threshold is reached.
