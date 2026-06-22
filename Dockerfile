FROM oven/bun:1

WORKDIR /app

RUN apt-get update && apt-get install -y openssh-client autossh netcat-openbsd && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock* ./
RUN bun install --production

COPY . .

EXPOSE 3000

CMD ["bun", "src/index.ts"]