FROM node:16

ENV COOKIE_SECRET CHANGEME!
ENV ADMIN_KEY CHANGEME!

#ENV REDIS_HOST redis://localhost:6379
ENV HOST 0.0.0.0
ENV DISPLAY_HOST localhost

ENV INDEX_PATH "./index.html"
ENV LOGIN_PATH "./login.html"
ENV VERIFY_PATH "./verify.html"

COPY ./src/index.js index.js
COPY package.json package.json
COPY ./src/index.html index.html
COPY ./src/login.html login.html
COPY ./src/verify.html verify.html

RUN npm install

EXPOSE 80

ENTRYPOINT [ "node", "index.js" ]