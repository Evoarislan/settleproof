FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY test-assets ./test-assets
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
