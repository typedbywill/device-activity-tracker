# Backend Dockerfile
FROM node:22-alpine

WORKDIR /app

# Install git and build dependencies
RUN apk add --no-cache git

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (ignore postinstall script that tries to install client deps)
RUN npm install --ignore-scripts

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Expose port (can be overridden by environment variable)
ARG PORT=3001
ENV PORT=${PORT}
EXPOSE ${PORT}

# Create directory for WhatsApp auth state and SQLite data
RUN mkdir -p /app/baileys_auth_info /app/data

CMD ["node", "dist/server.js"]
