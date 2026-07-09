FROM node:20-alpine

WORKDIR /app

COPY package.json server.js index.html styles.css app.js ./
COPY data ./data

ENV NODE_ENV=production

CMD ["node", "server.js"]
