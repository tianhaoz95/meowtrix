FROM node:20-slim

# Install dependencies needed for compiling node-pty and general development/testing
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Create workspace directory to prevent shell chdir failures
RUN mkdir -p /workspace

# Copy package files
COPY package*.json ./

# Install dependencies (compiles node-pty natively)
RUN npm install --omit=dev

# Copy the rest of the application
COPY . .

# Expose default port
EXPOSE 9123

# Set default HOST and PORT environment variables
ENV HOST=0.0.0.0
ENV PORT=9123

# Start the application
CMD [ "npm", "start" ]
