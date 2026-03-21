FROM node:20-slim

# git is required for cloning repos; curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files for the worker
COPY packages/worker/package.json ./packages/worker/
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install pnpm and worker deps
RUN npm install -g pnpm@10 \
 && pnpm install --filter @endorhq/rover-worker --frozen-lockfile || pnpm install --filter @endorhq/rover-worker

# Pre-install Claude Code CLI globally so tasks don't need to install it
RUN npm install -g @anthropic-ai/claude-code@latest

# Copy worker source
COPY packages/worker/ ./packages/worker/

WORKDIR /app/packages/worker

# Default port
ENV PORT=3701
EXPOSE 3701

CMD ["node", "server.js"]
