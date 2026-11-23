# JuxtaCrop

Herramienta de apoyo a la decisión para planificar rotaciones de cultivos (Reto NASA – UCU).

## Requisitos
- Docker Desktop

## Levantar todo
```
docker compose up --build
```

| Servicio | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend (docs) | http://localhost:8000/docs |
| Base de datos | localhost:5432 (user/pass/db: `juxtacrop`) |

Frenar: `Ctrl+C`. Borrar también la base: `docker compose down -v`.

## Estructura
- `frontend/` – Vite + React
- `backend/` – FastAPI
- `docs/` – requisitos, diseño, ADRs
- `demo/` – prototipo inicial
