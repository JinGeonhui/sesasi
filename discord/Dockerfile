FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY discord ./discord
USER node
CMD ["node", "discord/bot.mjs"]
