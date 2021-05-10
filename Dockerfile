# ------------------------------------------------------------------------------
# React Build Stage
# ------------------------------------------------------------------------------
FROM node:16.0.0-alpine as react-build

WORKDIR /app
ENV PATH /app/node_modules/.bin:$PATH
ENV REACT_APP_DOCKER "true"

# install the dependencies
COPY package.json .
COPY package-lock.json .
RUN npm ci --silent

# build the web app
COPY . .
RUN npm run build

# ------------------------------------------------------------------------------
# Final Stage
# ------------------------------------------------------------------------------
FROM node:16.0.0-alpine

WORKDIR /app
ENV IS_DOCKER "true"

EXPOSE 8081
HEALTHCHECK CMD curl --fail http://localhost:8081 || exit 1

LABEL org.opencontainers.image.url="https://web-syncplay.de" \
      org.opencontainers.image.description="Watch media in sync" \
      org.opencontainers.image.title="Web-SyncPlay" \
      maintainer="Yasamato <https://github.com/Yasamato>"

COPY --from=react-build /app/build /app/public
COPY index.js /app
COPY package-server.json /app/package.json

RUN npm install --silent

CMD ["npm", "run", "start"]
