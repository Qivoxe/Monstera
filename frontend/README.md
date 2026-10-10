# Monstera frontend

React and Vite frontend served through a small Express server. Express forwards `/api/v1` requests to FastAPI and keeps session cookies same-origin in local development.

## Run the connected app (PowerShell)

Start the API in one terminal:

```powershell
cd ..\backend
.\.venv\Scripts\Activate.ps1
$env:PYTHONPATH = (Get-Location).Path
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Start the web app in another terminal:

```powershell
cd ..\frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`. On first use, create an account with your name, email, password, and home city/town, or sign in to an existing account. Forecasts and the map use the saved location. Activity charts start empty and populate only with data you enter. Local SQLite storage is created at `backend/monstera.db`; profile and saved activity are associated with your account. New passwords must be at least 12 characters.

## Data sources and limits

PM2.5 forecast and place lookup use Open-Meteo services. The forecast represents regional CAMS model output, not a nearby monitor. The map marks your saved location and shows its regional forecast. Time comparison uses your saved home location, entered destination, departure times, and estimated duration; route geometry, traffic, transit filtration, and route-specific effects are not modeled. No calendar provider is connected.

Set `GEMINI_API_KEY` only if using the separate existing AI advisory endpoint. It is not needed for core app, account, SQLite, or forecast flows.
