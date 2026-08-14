FROM node:24-alpine3.23

WORKDIR /app

COPY package*.json ./
RUN npm ci || npm install
RUN sha256sum package-lock.json | awk '{print $1}' > node_modules/.package-lock.sha256

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]
