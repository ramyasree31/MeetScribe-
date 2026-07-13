# ARM64-native image — runs on Apple Silicon without QEMU emulation.
# Uses Playwright's bundled Chromium (ARM64 build) instead of Google Chrome (x86-only).
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    xvfb \
    pulseaudio \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

# Install Playwright's ARM64-native Chromium + all system deps
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
