FROM node:20-slim

# Install required system dependencies as root
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install Claude Code globally (needs root to install to /usr/local/lib/node_modules)
RUN npm install -g @anthropic-ai/claude-code@latest

WORKDIR /app

# Copy the worker packge.json directly and install (Build Context is packages/worker)
COPY package.json ./
RUN npm install

# Copy the rest of the worker code
COPY . ./

# Ensure the /app directory is owned by the node user
RUN chown -R node:node /app

# Create persistent storage directory (must be done as root, before USER node)
RUN mkdir -p /data && chown node:node /data
ENV STORAGE_PATH=/data

# Claude Code prevents --dangerously-skip-permissions when running as root for security reasons.
# Switch to the built-in non-root 'node' user to allow Claude CLI unattended execution.
USER node

ENV PORT=3701
EXPOSE 3701

CMD ["node", "server.js"]
