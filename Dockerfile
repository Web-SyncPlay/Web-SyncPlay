FROM node:12
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 8881
CMD ["npm", "run", "start"]