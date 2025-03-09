FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Build the Vue.js application
RUN npm run build

# Install a simple static file server to serve the built files
RUN npm install -g serve

EXPOSE 3000

# Serve the built files
CMD ["serve", "-s", "dist"]