# Build for linux/amd64 so we can install and run the official Google Chrome binary under Rosetta emulation on Apple Silicon.
FROM --platform=linux/amd64 node:20-bookworm-slim

# Install system utilities and display/audio managers
RUN apt-get update && apt-get install -y \
    xvfb \
    pulseaudio \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

# Install official Google Chrome stable and its dependencies via Playwright (compiled for amd64)
RUN npx playwright install --with-deps chrome

COPY . .
RUN npm run build

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
