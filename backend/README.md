# Monstera backend

FastAPI service with SQLAlchemy, Alembic migrations, and a free local SQLite database by default. Accounts use Argon2 password hashes, HTTP-only cookie sessions, CSRF tokens for writes, and per-user ownership for saved records.

## Run locally (PowerShell)

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
$env:PYTHONPATH = (Get-Location).Path
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

The database is `backend/monstera.db` and is ignored by git. SQLite is free and needs no separate database server. To use a hosted PostgreSQL instance later, set `DATABASE_URL` to its SQLAlchemy URL; the schema uses portable UUID and JSON types.

## Connected features

- `/api/v1/auth/*`: register with a display name, sign in, current session, sign out, and account deletion.
- `/api/v1/preferences`: save user preferences and home location/coordinates used for personalized forecasts.
- `/api/v1/air-quality/forecast`: fetch and persist hourly PM2.5 forecasts from Open-Meteo/CAMS (regional model output, not sensor readings).
- `/api/v1/locations/search`: geocode location names via Open-Meteo.
- `/api/v1/exposure/estimates` and `/api/v1/exposure/history`: save and retrieve user-entered exposure segments and estimates.
- `/api/v1/planner/*`: summarize logged activity and store selected planner actions.
- `/api/v1/simulations` and `/api/v1/routines`: calculate and save forecast comparisons and commute routines.
- `/api/v1/health` and `/api/v1/ready`: process and database health.

## Checks and migrations

```powershell
$env:PYTHONPATH = (Get-Location).Path
pytest
alembic upgrade head
```

Set `COOKIE_SECURE=true` behind HTTPS in production and configure `FRONTEND_ORIGINS` to exact trusted origins. Never commit `.env`. Open-Meteo is an external dependency and needs network access.
