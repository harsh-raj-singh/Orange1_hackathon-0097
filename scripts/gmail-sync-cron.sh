#!/bin/bash
# Gmail Sync Cron Script
# Run every 5 minutes: */5 * * * * /path/to/gmail-sync-cron.sh

set -e

API_URL="${API_URL:-https://6215-ij3ygi74kikgit27zui6x.e2b.app}"
MAX_EMAILS="${MAX_EMAILS:-50}"

echo "[$(date)] Starting Gmail sync..."

# Fetch emails from Gmail connector (you'd call this via Runable connector API)
# For now, this is a placeholder - in production, integrate with Pipedream/connector

# The sync endpoint expects emails in the request body
# This would be called by a scheduled Pipedream workflow or similar

curl -s -X POST "${API_URL}/api/gmail/sync" \
  -H "Content-Type: application/json" \
  -d '{"emails": [], "maxResults": '"${MAX_EMAILS}"'}'

echo "[$(date)] Gmail sync complete"
