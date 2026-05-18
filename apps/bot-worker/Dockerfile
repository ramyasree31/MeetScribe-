FROM mcr.microsoft.com/playwright:v1.44.0-jammy

RUN apt-get update && apt-get install -y \
    xvfb \
    pulseaudio \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
