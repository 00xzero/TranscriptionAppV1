FROM node:24-alpine3.23

WORKDIR /app

COPY package*.json ./
RUN npm ci || npm install

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]
