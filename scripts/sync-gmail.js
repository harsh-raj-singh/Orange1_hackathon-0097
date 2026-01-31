#!/usr/bin/env node
/**
 * Gmail Sync Script
 * 
 * This script fetches emails from Gmail and syncs them to NeuralChat.
 * Run every 5 minutes via cron or scheduler.
 * 
 * Usage:
 *   node sync-gmail.js [--max-results=50]
 * 
 * Environment:
 *   API_URL - NeuralChat API URL (default: https://6215-ij3ygi74kikgit27zui6x.e2b.app)
 *   GMAIL_CONNECTOR_RESULT - Path to Gmail connector result JSON
 */

const API_URL = process.env.API_URL || 'https://6215-ij3ygi74kikgit27zui6x.e2b.app';
const MAX_RESULTS = parseInt(process.argv.find(a => a.startsWith('--max-results='))?.split('=')[1] || '50');

async function syncGmail(emails) {
  console.log(`[${new Date().toISOString()}] Syncing ${emails.length} emails...`);
  
  const response = await fetch(`${API_URL}/api/gmail/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails, maxResults: MAX_RESULTS })
  });
  
  if (!response.ok) {
    throw new Error(`Sync failed: ${response.status} ${await response.text()}`);
  }
  
  const result = await response.json();
  console.log(`[${new Date().toISOString()}] Sync complete:`, result.message);
  return result;
}

async function getStats() {
  const response = await fetch(`${API_URL}/api/gmail/stats`);
  return response.json();
}

// Main
async function main() {
  try {
    // If emails are provided via stdin or file
    const emailsPath = process.env.GMAIL_CONNECTOR_RESULT;
    if (emailsPath) {
      const emails = require(emailsPath);
      await syncGmail(emails);
    } else {
      console.log('No emails provided. Set GMAIL_CONNECTOR_RESULT env var.');
      console.log('Current stats:', await getStats());
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
