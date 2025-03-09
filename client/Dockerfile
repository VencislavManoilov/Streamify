FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Copy the .env file
COPY .env .env

# Load environment variables and build the Vue.js application
RUN npm install dotenv && npm run build

# Install a simple static file server to serve the built files
RUN npm install -g serve

EXPOSE 3000

# Serve the built files
CMD ["serve", "-s", "dist"]