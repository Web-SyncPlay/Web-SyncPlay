FROM node:12
WORKDIR /app
COPY . .
RUN npm install
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "run", "start"]