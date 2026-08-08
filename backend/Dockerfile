FROM node:20-alpine AS builder

# Working directory inside container
WORKDIR /app

# Copy dependency files (now looking directly in current directory)
COPY package*.json ./
COPY requirements.txt ./

# Install dependencies
RUN npm install --omit=dev

# Copy all remaining source code from backend/
COPY . .

# Start your application
CMD ["npm", "start"]