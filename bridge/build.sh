#!/bin/sh
set -e
cd "$(dirname "$0")"
mkdir -p bin
xcrun swiftc -O fm-bridge.swift -o bin/fm-bridge
echo "built bridge/bin/fm-bridge"
