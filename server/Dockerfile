FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8080

# Increase memory limit
ENV NODE_OPTIONS="--max-old-space-size=2048"

CMD ["npm", "start"]
