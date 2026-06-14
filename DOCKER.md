# DevTasks en Docker (Hetzner + Traefik)

App Express + React con SQLite. La base se guarda en un **volumen** (`devtasks-data`)
para que persista entre reinicios y rebuilds. Login por **Basic Auth**.

## 1. Preparar variables

Copia el ejemplo y edítalo:

```bash
cp .env.example .env
nano .env
```

- `AUTH_USER` / `AUTH_PASS`: tu usuario y contraseña para entrar.
- `APP_HOST`: hostname para Traefik. Sin dominio usa **nip.io** con tu IP pública,
  por ej. si tu server es `5.75.130.20` → `APP_HOST=devtasks.5.75.130.20.nip.io`.

## 2. Verificar la red de Traefik

El compose espera una red externa llamada `traefik`. Confirma el nombre real:

```bash
docker network ls
```

Si tu Traefik usa otra red (común: `proxy`, `web`), cambia el nombre en la sección
`networks:` del `docker-compose.yml`.

## 3. Levantar

```bash
docker compose up -d --build
```

## 4. Entrar

- Vía Traefik:  `http://devtasks.TU-IP.nip.io`
- Directo por IP (fallback, puerto expuesto): `http://TU-IP:3001`

Desde el celular, abre cualquiera de esas URLs y mete usuario/contraseña.

## Operaciones útiles

```bash
docker compose logs -f          # ver logs
docker compose up -d --build    # actualizar tras cambiar código
docker compose down             # parar (la DB queda en el volumen)
```

## Backup de la base

La DB vive en el volumen `devtasks-data`. Para sacar una copia:

```bash
docker run --rm -v devtasks-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/devtasks-backup.tar.gz -C /data .
```

## Notas

- Sin dominio no hay HTTPS (Traefik por IP/nip.io va en HTTP). Si más adelante
  apuntas un dominio real, se le puede agregar HTTPS automático con Let's Encrypt.
- Solo hay un timer activo a la vez (igual que en local).
