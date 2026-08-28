FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install curl for health checks and container utilities
RUN apk add --no-cache curl

# Copy package manifests
COPY package*.json ./

# Install production dependencies and Higgsfield CLI
RUN npm install --production
RUN npm install -g @higgsfield/cli

# Ensure uploads directory exists
RUN mkdir -p /app/uploads

# Copy application source files
COPY . .

# Expose Web Dashboard port
EXPOSE 3000

# Set production environment defaults
ENV PORT=3000
ENV NODE_ENV=production
ENV CDP_HOST=host.docker.internal
ENV CDP_PORT=9333

# Container Health Check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# Start the application server
CMD ["node", "server.js"]

