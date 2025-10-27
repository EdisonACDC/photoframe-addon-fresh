ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.20
FROM $BUILD_FROM

# Install Node.js
RUN apk add --no-cache nodejs npm bash

WORKDIR /app

# Copy application files
COPY dist ./dist
COPY package.json ./
RUN npm install --production --omit=dev

# Create data directories
RUN mkdir -p /data/uploads /app/certs

# Set environment
ENV NODE_ENV=production
ENV PORT=5000
ENV HTTPS_PORT=5443
ENV UPLOAD_DIR=/data/uploads

EXPOSE 5000 5443

# Run directly - no scripts, no complexity
CMD ["sh", "-c", "mkdir -p /data/uploads && chmod 777 /data/uploads && exec node dist/index.js"]
