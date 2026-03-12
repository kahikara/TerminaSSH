#!/usr/bin/env bash
ts=$(date +"%Y-%m-%d_%H-%M-%S")
tar \
  --exclude='node_modules' \
  --exclude='src-tauri/target' \
  --exclude='dist' \
  --exclude='.git' \
  --exclude='*.tar.gz' \
  -czf "termina-ssh-snapshot_$ts.tar.gz" .
