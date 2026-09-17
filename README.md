# TANTO Operation Jakarta – KPI Dashboard

This project is a React + Vite dashboard for monitoring TANTO Jakarta operational KPI metrics.

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy environment variables:
   ```bash
   copy .env.example .env
   ```
3. Start the frontend:
   ```bash
   npm run dev
   ```
4. If you want to test API endpoints locally, run the Vercel dev server:
   ```bash
   npx vercel dev
   ```

The frontend is available at `http://localhost:5173` and the API runs on the Vercel local dev domain (typically `http://localhost:3000` when using `vercel dev`).

## Production build

```bash
npm run build
```

## Deploy to Vercel

1. Push the project to GitHub.
2. Create a new project in Vercel and import the repository.
3. Set the framework to `Vite`.
4. Add environment variables from `.env.example` in Vercel project settings.
5. Deploy.

## Required environment variables

- `DATABASE_URL` — PostgreSQL connection string for production database.
- `JWT_SECRET` — secret used by server-side auth if needed.
- `VITE_API_URL` — frontend API endpoint.
- `VITE_API_TOKEN` — optional API token for protected endpoints.
- `APP_ENV` — `development` or `production`.

## API overview

- `GET /api/reporting` — read reporting records
- `POST /api/reporting` — create reporting record
- `PATCH /api/reporting` — update existing record
- `DELETE /api/reporting` — delete record

## Database placement

The application is designed to keep the database outside the browser. The data is stored in an online database managed by Vercel-compatible Postgres (for example, Neon/Postgres), while the frontend reads and writes through API routes that live in the project.

## Security notes

- No credentials are hardcoded in source files.
- All secrets are provided via environment variables.
- Browser-side code only receives the API URL and any non-secret public config.
