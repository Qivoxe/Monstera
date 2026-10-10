# Monstera

Monstera is an air pollution awareness and personal exposure planning app. A user creates an account, saves their home location, checks regional PM2.5 forecasts, logs exposure activities, and compares forecast conditions between their home and a destination.

This repository contains a React frontend and a FastAPI backend. The frontend's Express server serves the built app and proxies `/api/v1` requests to FastAPI, keeping browser API calls same-origin. Local development uses SQLite. The planned production platform is AWS.

## Project status

- The frontend and backend are connected for account, profile, forecast, exposure, planner, simulation, and routine flows.
- Database schema changes are managed with Alembic migrations.
- Local development defaults to SQLite and requires no database service.
- AWS is the deployment target, but this repository does not currently include Dockerfiles, an AWS CDK/CloudFormation/Terraform stack, CI/CD workflows, or deployed AWS resources. The AWS section below is the deployment plan, not a claim that the app is already hosted.

## Features

- First-use registration with display name, email, password, and home city/town; returning users can sign in. Passwords must be at least 12 characters.
- Saved home location and coordinates used for the user's forecast and map.
- Hourly PM2.5 forecast retrieval and persistence using Open-Meteo/CAMS model data.
- Location lookup through Open-Meteo geocoding.
- Exposure activity entry and account-specific exposure history.
- Planner summaries and saved actions based on the user's logged activity.
- Time comparisons between the saved home location and a destination, with departure times and an estimated duration; saved simulations and commute routines.
- Session-protected records scoped to the signed-in account.

New accounts start with empty activity history. Forecast data is regional model output, not a measurement from a nearby sensor. The map presents the saved location and forecast; it does not claim that a sensor is located there.

## Architecture

```text
Browser
  -> Express web server (port 3000)
       -> serves React/Vite static build
       -> proxies /api/v1/* to FastAPI (port 8000)
            -> SQLAlchemy + Alembic
            -> SQLite locally / PostgreSQL for AWS
            -> Open-Meteo geocoding and air-quality APIs
```

### Main components

| Path | Responsibility |
| --- | --- |
| `frontend/src/` | React application, onboarding, account-aware views, and API client |
| `frontend/server.ts` | Express server, API proxy, and production static-file serving |
| `frontend/.env.example` | Frontend API base path and backend proxy URL |
| `backend/app/api/` | FastAPI routes and request dependencies |
| `backend/app/services/` | Forecast, exposure, and planner business logic |
| `backend/app/models.py` | SQLAlchemy persistence models |
| `backend/alembic/` | Database schema migrations |
| `backend/tests/` | Backend unit and API tests |

### API routes

All application routes are under `/api/v1`.

| Route group | Purpose |
| --- | --- |
| `/auth/*` | Register, sign in/out, retrieve the current session, and account deletion |
| `/preferences` | User settings and saved home location |
| `/locations/search` | Geocode a place name |
| `/air-quality/forecast` | Retrieve and persist forecast data |
| `/exposure/estimates`, `/exposure/history` | Record and view exposure activity |
| `/planner/*` | Activity summaries and planner actions |
| `/simulations`, `/routines` | Forecast comparisons and saved commute routines |
| `/health`, `/ready` | Process health and database readiness |

`/health` checks that the API process responds. `/ready` also checks database connectivity and is the better deployment readiness probe.

## Technology

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Leaflet, Express
- **Backend:** Python, FastAPI, Pydantic Settings, SQLAlchemy, Alembic
- **Authentication:** Argon2 password hashes, HTTP-only cookie sessions, CSRF protection for write requests
- **Local database:** SQLite (`backend/monstera.db`)
- **Production database target:** Amazon RDS for PostgreSQL
- **Forecast and geocoding provider:** Open-Meteo (including CAMS regional model forecast)
- **Optional integration:** `GEMINI_API_KEY` is only for a separate advisory endpoint; it is not needed for the main app flows.

## Run locally on Windows PowerShell

Use Node.js/npm and Python installed on your machine. Open two PowerShell terminals from the repository root.

### 1. Start the backend

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
$env:PYTHONPATH = (Get-Location).Path
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Keep this terminal running. The local SQLite database is created in `backend/monstera.db` when the migrations run.

### 2. Start the frontend

In the second terminal, from the repository root:

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Open **http://localhost:3000**. Register with your details and home location, then use the app. The browser should use `localhost`, not `0.0.0.0`; the latter is a bind address rather than a browser destination.

### Useful development commands

Frontend, from `frontend/`:

```powershell
npm run lint
npm run build
```

Backend, from `backend/` with the virtual environment active:

```powershell
$env:PYTHONPATH = (Get-Location).Path
pytest
alembic upgrade head
```

## Database and migrations

SQLite is convenient for a single local developer. The database file is ignored by git and should not be used as persistent production storage on an ephemeral container filesystem. For AWS, use PostgreSQL on Amazon RDS and pass the SQLAlchemy connection string through the ECS task's secret configuration. The backend installs the `psycopg` driver.

Example connection string format (put the real value in AWS Secrets Manager, not in source control):

```text
postgresql+psycopg://USER:PASSWORD@RDS_ENDPOINT:5432/DATABASE?sslmode=require
```

Before deploying a backend release, run `alembic upgrade head` as a controlled one-off migration task using the same image and database configuration as the service. Back up production data before schema changes and review migrations before applying them.

## AWS deployment plan

### Recommended layout

```text
Internet
  -> Route 53 domain + ACM TLS certificate
       -> Public Application Load Balancer (HTTPS)
            -> ECS service on AWS Fargate (private subnets)
                 -> Express web container: React static build + /api/v1 proxy
                 -> FastAPI container: private service endpoint
                      -> Amazon RDS for PostgreSQL (private subnets)

Amazon ECR stores container images
AWS Secrets Manager stores DATABASE_URL and optional API keys
Amazon CloudWatch receives container logs and service metrics
```

Run Express and FastAPI as separate containers/services in the same VPC. The Express container serves the built frontend and proxies API traffic to the private FastAPI service using `BACKEND_API_URL`. Keep FastAPI and PostgreSQL inaccessible from the public internet. The public Application Load Balancer should forward HTTPS to Express; configure its target group health check to request `/api/v1/ready` through Express. Fargate target groups use IP targets. For additional availability, run multiple tasks across Availability Zones and configure an ECS service desired count and scaling appropriate to expected traffic.

AWS's [ECS Fargate networking guide](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html) describes task networking and load balancer support. See [ECS load balancing](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html), [private RDS access](https://docs.aws.amazon.com/AmazonRDS/latest/gettingstartedguide/security-public-private.html), and [injecting Secrets Manager values into ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html).

### Deployment work still required

1. Add Dockerfiles for the frontend and backend, plus a local compose setup if desired. Build the Vite frontend into `frontend/dist` as part of the web image; run Express with `NODE_ENV=production` so it serves those files. Run FastAPI with Uvicorn bound to `0.0.0.0:8000` inside its container.
2. Create AWS networking: a VPC with public subnets for the load balancer and private subnets for Fargate and RDS, with security groups that allow only the required paths. The backend must have outbound access to Open-Meteo; provide NAT or suitable egress endpoints for private tasks.
3. Create an Amazon ECR repository and push versioned frontend/backend images. AWS provides a [container image push workflow](https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html).
4. Create an ECS cluster, task definitions, and services for Express and FastAPI. Configure health checks, CloudWatch log groups, task roles, resource sizing, and deployment rollback behavior.
5. Create an RDS PostgreSQL database in private subnets, configure backups, encryption, and a database security group that accepts PostgreSQL only from the backend task security group. RDS requires subnets in at least two Availability Zones for a DB subnet group; Multi-AZ improves availability but increases cost. See [RDS VPC guidance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html).
6. Store `DATABASE_URL` and any optional `GEMINI_API_KEY` in AWS Secrets Manager and reference them from the ECS task definition. Do not bake secrets into container images or put them in GitHub Actions logs.
7. Configure Express with `BACKEND_API_URL` set to the private FastAPI service address, `VITE_API_BASE_URL=/api/v1`, and `NODE_ENV=production`. Configure FastAPI with `DATABASE_URL` from Secrets Manager, `COOKIE_SECURE=true`, `SESSION_DAYS=14` (or the chosen policy), a suitable `LOG_LEVEL`, and exact trusted `FRONTEND_ORIGINS` values.
8. Add an ACM certificate and Route 53 DNS record for the load balancer. Enforce HTTPS and verify that the cookie remains HTTP-only, secure, and same-origin through the proxy.
9. Run the Alembic migration task against RDS before routing production traffic. Verify registration, sign-in/out, the readiness endpoint, forecast retrieval, and account-scoped persistence against the deployed database.
10. Add a CI/CD pipeline to build, scan, and publish immutable images, deploy to ECS, run migrations in a controlled step, and support rollback. No CI/CD pipeline is included yet.

For a smaller learning environment, AWS App Runner or a single task may reduce setup work, but database persistence and secrets still need to be configured. AWS resources can incur charges (notably NAT gateways, load balancers, Fargate tasks, and RDS); review current regional pricing and budgets before creating them. No AWS account resources have been created by this repository.

### Production environment variables

| Service | Variable | Purpose |
| --- | --- | --- |
| Express | `PORT` | HTTP listen port; use the same port as the ECS container/target group |
| Express | `NODE_ENV=production` | Enables static serving from the Vite `dist` build |
| Express | `BACKEND_API_URL` | Private FastAPI base URL, such as `http://monstera-api.internal:8000` |
| Express | `VITE_API_BASE_URL=/api/v1` | Same-origin browser API path; set at frontend build time if used by Vite |
| FastAPI | `DATABASE_URL` | RDS PostgreSQL SQLAlchemy URL; inject from Secrets Manager |
| FastAPI | `COOKIE_SECURE=true` | Marks session cookies secure for HTTPS deployment |
| FastAPI | `FRONTEND_ORIGINS` | Comma-separated exact trusted browser origins |
| FastAPI | `SESSION_DAYS` | Session lifetime in days |
| FastAPI | `LOG_LEVEL` | Application log level |
| FastAPI | `OPEN_METEO_BASE_URL` | Open-Meteo air-quality endpoint |
| Optional | `GEMINI_API_KEY` | Only needed for the separate advisory endpoint |

Frontend variables prefixed `VITE_` are embedded into the browser bundle at build time. Do not put credentials or private values in `VITE_*` variables.

## Security and operations

- Never commit `.env`, database files, passwords, API keys, or production connection strings.
- Use HTTPS in production and set `COOKIE_SECURE=true`.
- Keep RDS private; allow database ingress only from the backend service security group.
- Use least-privilege IAM task roles and Secrets Manager permissions.
- Use backups and a tested restore process for production database data.
- Monitor ECS task health, `/api/v1/ready`, CloudWatch logs, database capacity, and forecast-provider failures.
- Open-Meteo requires outbound network access and can fail independently of Monstera; the app should not treat forecasts as guaranteed real-time sensor readings.

## Product limitations

- Forecasts are regional model estimates, not local monitor readings or guarantees of a user's personal exposure.
- Time comparison uses endpoint locations and the duration entered by the user. It does not model route geometry, traffic, transport mode, indoor filtration, or route-specific pollution.
- No calendar provider is connected.
- The optional Gemini advisory endpoint is separate from core onboarding, forecast, exposure, and planning flows.

## AWS references

- [Deploy a Fargate web service behind an Application Load Balancer](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/tutorial-ecs-web-server-cdk.html)
- [Amazon ECR: push a Docker image](https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html)
- [ECS Fargate networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html)
- [Amazon RDS private access](https://docs.aws.amazon.com/AmazonRDS/latest/gettingstartedguide/security-public-private.html)
- [ECS task definition Secrets Manager values](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
