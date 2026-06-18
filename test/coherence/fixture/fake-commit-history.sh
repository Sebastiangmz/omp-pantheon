#!/usr/bin/env bash
set -euo pipefail

git init -b main
git config user.email test@example.com
git config user.name 'Test User'
git config commit.gpgsign false
git commit --allow-empty -m 'initial'
git commit --allow-empty -m 'docs: no trailer'
git commit --allow-empty -m $'fix: login\n\nSpec-Slice: CUR-92'
git commit --allow-empty -m 'chore: still no trailer'
git commit --allow-empty -m $'test: another slice\n\nSpec-Slice: CUR-92'
git commit --allow-empty -m 'docs: tail commit'
