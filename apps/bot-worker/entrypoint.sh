#!/bin/bash
set -e

# Start Xvfb
export DISPLAY=:99
Xvfb :99 -screen 0 1280x720x24 &

# Start PulseAudio
pulseaudio -D --exit-idle-time=-1
pacmd load-module module-virtual-sink sink_name=v1

# Run the Node application
exec node dist/index.js
