FROM node:16.15
WORKDIR /app

COPY package.json yarn.lock ./

RUN npm install

COPY . ./

RUN npm run build
EXPOSE 3000
CMD npm run start
