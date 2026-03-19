#!/bin/bash
# git-credentials.sh — Configure GitHub authentication via GITHUB_TOKEN
# This script runs inside the Rover agent container before the agent starts.
# It uses URL rewriting so git operations on github.com automatically use the PAT.

if [ -n "$GITHUB_TOKEN" ]; then
  git config --global url."https://${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
  echo "✓ Git configured to use GITHUB_TOKEN for private repo access"
else
  echo "ℹ GITHUB_TOKEN not set — only public repos accessible"
fi
