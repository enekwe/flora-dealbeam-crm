FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Railway injects PORT dynamically and handles healthchecks via railway.toml — no EXPOSE/HEALTHCHECK here.

CMD ["npm", "start"]
