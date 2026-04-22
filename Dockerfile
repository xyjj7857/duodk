# Stage 1: Build
FROM node:20 AS builder

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .

# Debug: List files to ensure casing is correct in the build context
RUN ls -R src/components

RUN npm run build

# Stage 2: Final image
FROM node:20-slim
WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy production dependencies
COPY package*.json ./
RUN npm install --production

# Copy build artifacts and server
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/vite.config.ts ./

# Create data and logs directories
RUN mkdir -p data logs

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Start the application
CMD ["npx", "tsx", "server.ts"]
