FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY test-assets ./test-assets
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
