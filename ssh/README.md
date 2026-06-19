Coloca aqui la llave privada `vpaz.pem` usada por el servicio `db-tunnel`
del `docker-compose.yml` para conectarse a `vpaz@100.27.20.188`.

Este archivo (`*.pem`) esta excluido en `.gitignore` y nunca debe subirse
al repo. En EasyPanel, sube la llave como archivo/secret montado en
`./ssh/vpaz.pem` dentro del volumen del stack, o usa la funcion de
"Files"/"Mounts" del servicio para inyectarla en tiempo de deploy.

Permisos esperados por SSH: 600 (el entrypoint del contenedor ya lo ajusta).
