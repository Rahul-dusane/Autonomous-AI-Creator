FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY backend ./backend

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend ./backend
WORKDIR /app/backend

EXPOSE 8080

CMD ["node", "src/server.js"]