#!/bin/sh
set -e

mkdir -p /root/.ssh
if [ -n "$SSH_PRIVATE_KEY" ]; then
  printf '%s\n' "$SSH_PRIVATE_KEY" > /root/.ssh/id_rsa
elif [ -f /ssh_key ]; then
  cp /ssh_key /root/.ssh/id_rsa
else
  echo "ERROR: No SSH key provided (SSH_PRIVATE_KEY or /ssh_key)" >&2
  exit 1
fi
chmod 600 /root/.ssh/id_rsa

ssh-keyscan -H "$SSH_HOST" >> /root/.ssh/known_hosts 2>/dev/null || true

export AUTOSSH_GATETIME=0

exec autossh -M 0 -N \
  -o "ServerAliveInterval 30" \
  -o "ServerAliveCountMax 3" \
  -o "ExitOnForwardFailure yes" \
  -i /root/.ssh/id_rsa \
  -L "0.0.0.0:${LOCAL_PORT:-3306}:${REMOTE_HOST:-127.0.0.1}:${REMOTE_PORT:-3306}" \
  "${SSH_USER}@${SSH_HOST}"
