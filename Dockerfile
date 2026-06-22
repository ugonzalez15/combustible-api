FROM oven/bun:1

WORKDIR /app

RUN apt-get update && apt-get install -y openssh-client autossh netcat-openbsd && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock* ./
RUN bun install --production

COPY . .

EXPOSE 3000

CMD sh -c 'echo "[start] preparando ssh" && mkdir -p /root/.ssh && echo "$SSH_PRIVATE_KEY_B64" | base64 -d > /root/.ssh/id_rsa && chmod 600 /root/.ssh/id_rsa && echo "[start] probando ssh" && ssh -vvv -i /root/.ssh/id_rsa -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -N -L 127.0.0.1:3306:127.0.0.1:3306 "$SSH_USER@$SSH_HOST" -p ${SSH_PORT:-22}'