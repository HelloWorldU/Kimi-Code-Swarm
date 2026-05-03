#!/usr/bin/env node
/**
 * Setup Git hooks path
 * Run automatically via npm postinstall
 * Cross-platform: works on Windows, macOS, Linux
 */

const { execSync } = require('child_process')

function main() {
  // Check if we're in a git repository
  try {
    execSync('git rev-parse --git-dir', { stdio: 'pipe' })
  } catch {
    console.log('⚠️  Not a git repository, skipping hook setup')
    process.exit(0)
  }

  try {
    execSync('git config core.hooksPath ci/hooks', { stdio: 'inherit' })
    console.log('✅ Git hooks configured: ci/hooks')
  } catch (err) {
    console.error('❌ Failed to configure hooks:', err.message)
    // Don't block npm install
    process.exit(0)
  }
}

main()
