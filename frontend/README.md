# Zelosify Recruit Frontend

Next.js 15 (App Router) frontend for the Vendor–Hiring Manager Contract
Management Module. Talks to the Node backend (`../backend`) over
REST; the backend in turn talks to the Python AI agent service — this app
never calls the agent directly.

## The two personas that matter for this module

- **IT Vendor** (`/vendor/openings`, `/vendor/openings/[id]`) — browses
  contract openings for their tenant, drag-and-drop uploads candidate
  resumes (PDF/PPTX), sees their own submissions and can soft-delete them.
  Never sees the AI recommendation or other vendors' uploads.
- **Hiring Manager** (`/hiring-manager/openings`, `/hiring-manager/openings/[id]`) —
  sees only their own openings, reviews submitted profiles with the AI
  recommendation (badge, score %, confidence %, explanation, processing
  time), shortlists or rejects.

Both routes are protected by `src/middleware.js`, which redirects
unauthenticated requests to `/login` and routes each role to its own
dashboard on sign-in. Role-based sidebar navigation lives in
`src/components/UserDashboardPage/SideBar/Routes/ItemRoutes.jsx`.

The rest of the app (landing page, `/user`, `/business-user/*`,
`/vendor/payments`) is pre-existing scaffold from the larger Zelosify
Recruit product this module was carved out of — not part of this
assignment's scope, left intact rather than gutted.

## Getting started

```bash
npm install
cp .env.local.example .env.local
npm run dev                         # http://localhost:5173
```

### Required environment variable

```
NEXT_PUBLIC_BACKEND_URL=http://localhost:5000/api/v1
```

The backend must be running (see `../backend/README.md`) for
anything beyond the static shell to work — without it, the openings pages
render their empty state and a toast error rather than crashing (verified
by actually running the app with the backend down: no console errors,
just the expected network failure surfaced to the user).

## Where things live

```
src/
  app/(UserDashBoard)/vendor/openings/          # IT Vendor pages
  app/(UserDashBoard)/hiring-manager/openings/   # Hiring Manager pages
  components/UserDashboardPage/IT_VENDOR/Openings/
  components/UserDashboardPage/HIRING_MANAGER/Openings/
  redux/features/Vendor/vendorOpeningsSlice.js
  redux/features/HiringManager/hiringManagerSlice.js
```

Each route segment has its own `loading.jsx` (skeleton, via shadcn's
`Skeleton`) and `error.jsx` (using the shared `ErrorComponent`, wired to
Next's automatic route-segment error boundaries) — not a single global
spinner/error page.

Notable implementation details:

- **Drag-drop upload** via `react-dropzone`, restricted to PDF/PPTX,
  multi-file.
- **Table virtualization** (`@tanstack/react-virtual`) kicks in above 50
  profiles on the hiring-manager detail page; below that it just renders
  the list directly.
- **Dark mode** via `next-themes`, already wired at the root provider —
  verified visually across the sidebar, tables, and empty states.
- **A "scanned" badge** on profile cards when `recommendation.usedVisionFallback`
  is true, surfacing when the agent had to fall back to image-based
  extraction instead of reading the resume's text layer.

## Testing this app

There's no frontend test suite (Jest/RTL) yet — verification here has been
`next build` (type/syntax correctness) plus driving the actual running
app with Playwright: navigating every route unauthenticated (confirms the
middleware redirect) and authenticated (a hand-built JWT cookie, since no
Keycloak realm is configured in this environment), checking for console
errors and taking screenshots of each state, including the missing-opening
error toast and the dark-mode toggle.
