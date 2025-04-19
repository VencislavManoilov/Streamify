# Build stage
FROM node:16-alpine as build-stage

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Copy the .env file if it exists, otherwise use .env.example
COPY .env* ./

# Build the app
RUN npm run build

# Production stage with Nginx
FROM nginx:stable-alpine as production-stage

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from the build stage
COPY --from=build-stage /app/dist /usr/share/nginx/html

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]