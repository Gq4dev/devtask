# CI/CD: git push -> deploy automatico

Flujo: hacés `git push` -> GitHub Actions construye la imagen y la publica en
GHCR -> llama a un webhook de Portainer -> Portainer baja la imagen nueva y
redepliega. Cero comandos manuales despues del setup inicial.

- Repo: `Gq4dev/devtask`
- Imagen: `ghcr.io/gq4dev/devtask:latest`

---

## Setup inicial (una sola vez)

### 1. Primer push del codigo
```bash
cd "c:/Users/Guillote/Desktop/ESCRITORIO/GQ4DEV/DEVTASKS/devtasks/devtasks"
git add .
git commit -m "Docker + CI/CD"
git push -u origin master
```
> El `.env` NO se sube (esta en `.gitignore`). Verificado.

### 2. Esperar el primer build
Andá a la pestaña **Actions** del repo en GitHub. El workflow "Build and deploy"
va a construir y publicar la imagen. La primera vez tarda un par de minutos.

### 3. Hacer publica la imagen en GHCR
Por defecto el paquete sale privado aunque el repo sea publico. Para que Portainer
la baje sin credenciales:
- GitHub -> tu perfil -> **Packages** -> `devtask`
- **Package settings** -> **Change visibility** -> **Public**

### 4. Crear el Stack en Portainer
`Stacks` -> `Add stack` -> nombre `devtasks` -> **Web editor**, y pegá el contenido
de `docker-compose.portainer.yml`.

En **Environment variables** agregá:
| Name | Value |
|------|-------|
| `AUTH_USER` | tu usuario |
| `AUTH_PASS` | tu contrasena |
| `APP_HOST` | `devtasks.TU-IP.nip.io` |

Verificá que la red `traefik` exista (`Networks` en Portainer); si tiene otro
nombre, ajustalo en el compose antes de desplegar.

`Deploy the stack`.

### 5. Activar el webhook del Stack
En Portainer, abrí el stack `devtasks` -> en el editor buscá la opcion
**Webhook** (o "Create webhook") y activala. Te da una URL tipo:
`https://TU-PORTAINER/api/stacks/webhooks/xxxxxxxx-xxxx-...`

Copiala.

### 6. Guardar el webhook como secret en GitHub
GitHub repo -> **Settings** -> **Secrets and variables** -> **Actions** ->
**New repository secret**:
- Name: `PORTAINER_WEBHOOK`
- Value: la URL del paso 5

---

## A partir de ahora

```bash
git add .
git commit -m "lo que cambiaste"
git push
```
GitHub Actions construye, publica y dispara el redeploy. En ~2 min lo ves en el cel.

> Si todavia no configuraste el webhook (paso 5-6), el deploy igual publica la
> imagen; solo te faltaria darle "Recreate" manual al stack en Portainer (o
> activar el webhook para que sea automatico).

---

## Acceso
- `http://devtasks.TU-IP.nip.io` (via Traefik)
- `http://TU-IP:3001` (directo, fallback)

Login con el `AUTH_USER` / `AUTH_PASS` que pusiste en Portainer.
