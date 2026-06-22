FROM oven/bun:1

WORKDIR /app

RUN apt-get update && apt-get install -y openssh-client autossh && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock* ./
RUN bun install --production

COPY . .

EXPOSE 3000

CMD sh -c 'mkdir -p /root/.ssh && echo "$SSH_PRIVATE_KEY_B64" | base64 -d > /root/.ssh/id_rsa && chmod 600 /root/.ssh/id_rsa && ssh-keyscan -p ${SSH_PORT:-22} "$SSH_HOST" >> /root/.ssh/known_hosts && autossh -f -M 0 -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -L 127.0.0.1:3306:127.0.0.1:3306 "$SSH_USER@$SSH_HOST" -p ${SSH_PORT:-22} && bun src/index.ts'