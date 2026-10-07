#!/bin/bash
# Starts the Hayden OS worker. Model weights stay on the network volume.
set -euo pipefail
mkdir -p /opt/hayden-worker
exec python3 -u /opt/hayden-worker/server.py
