# Use a small, stable Node LTS image
FROM node:20-alpine

# Create app directory inside container
WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# App listens on 3000 (Northflank maps to this)
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
