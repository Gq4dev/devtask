# DevTasks

Task manager self-hosted con **time tracking por proyecto**, pensado para devs que llevan varios proyectos en paralelo. Sin cuentas, sin nube: tus datos viven en un archivo SQLite local (`server/devtasks.db`).

## Stack

- **Frontend:** React + Vite
- **Backend:** Express + SQLite (`node:sqlite` nativo, sin binarios que compilar)
- **Requisito:** Node.js **22.5+** (por el módulo `node:sqlite`)

## Instalación

```bash
npm run install:all      # instala raiz + cliente
```

## Desarrollo (hot reload)

```bash
npm run dev
```

- Cliente: http://localhost:5173
- API: http://localhost:3001 (el cliente le pega via proxy)

## Producción (un solo proceso)

```bash
npm run build            # genera client/dist
npm start                # sirve API + frontend en http://localhost:3001
```

## Qué incluye

- 4 proyectos creados al primer arranque (renombrables, con color; podés agregar/borrar).
- Tablero por estados: **Por hacer → En curso → Hecho**.
- Prioridad (low/medium/high) y estimación en minutos por tarea.
- **Cronómetro por tarea**: un solo timer activo a la vez; al iniciar uno se cierra el anterior automáticamente. El tiempo corre en vivo en la barra superior.
- Panel **Tiempo por proyecto** con totales y barra comparativa.

## Atajos de uso

- Escribí en el campo de nueva tarea y **Enter** para agregar.
- **▶ track** inicia el cronómetro (mueve la tarea a "En curso" si estaba en "Por hacer").
- **Doble click** sobre un proyecto en la barra lateral para editarlo.

## Estructura

```
devtasks/
├── server/index.js      # API REST + esquema SQLite
├── client/src/App.jsx   # UI completa
├── client/src/styles.css
└── package.json         # scripts dev / build / start
```

## Datos

Todo se guarda en `server/devtasks.db`. Para hacer backup, copiá ese archivo. Para empezar de cero, borralo y reiniciá el server.
