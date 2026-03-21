FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including tsx for running TypeScript)
RUN npm install

# Copy server source files
COPY server ./server
COPY tsconfig.json ./

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose port
EXPOSE 8080

# Start server using tsx
CMD ["npx", "tsx", "server/index.ts"]
