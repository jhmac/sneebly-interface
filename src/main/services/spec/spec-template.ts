export const SPEC_TEMPLATE = `# SPEC: {{featureName}}

> Source milestone: {{milestoneText}}
> Phase: {{phase}}
> Generated: {{timestamp}}
> Research depth: {{depth}}

<!-- locked sections are respected by the daemon — add this comment to any section you've manually refined -->

## Overview

_One paragraph summary of what this feature does and why it matters to users._

## User Experience

### User Stories

- As a **[user type]**, I want to **[action]** so that **[outcome]**.
- As a **[user type]**, I want to **[action]** so that **[outcome]**.

### UI Specification

#### Layout

\`\`\`
+------------------------------------------+
|  [Header / Nav]                          |
+------------------------------------------+
|  [Main content area description]         |
|                                          |
|  [Component A]     [Component B]         |
|                                          |
|  [Footer / CTA]                          |
+------------------------------------------+
\`\`\`

#### States

| State | Trigger | UI behavior |
|-------|---------|-------------|
| Empty | No data exists | Show placeholder with CTA |
| Loading | Async fetch in progress | Skeleton / spinner |
| Success | Data loaded | Render list/form/content |
| Validation error | Form submit with invalid fields | Inline field errors |
| Network error | API call fails | Error banner, retry button |
| Unauthorized | User lacks permission | Redirect or 403 message |

#### Interactions

- _Describe click, hover, keyboard, drag, swipe behaviors_
- _Tab order for accessibility_
- _Keyboard shortcuts if any_

#### Responsive Behavior

- Mobile (< 640px): _describe_
- Tablet (640–1024px): _describe_
- Desktop (> 1024px): _describe_

## Data Model

### Tables / Collections

\`\`\`sql
-- Example: replace with actual schema
CREATE TABLE example (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_example_user_id ON example(user_id);
CREATE INDEX idx_example_status  ON example(status) WHERE status = 'active';
\`\`\`

### Migrations Needed

1. _Migration 001: create table X_
2. _Migration 002: add column Y to table Z_

## Backend

### Endpoints

#### \`POST /api/example\`
**Auth:** Bearer token required
**Request:**
\`\`\`json
{
  "name": "string (required, max 255)",
  "metadata": "object (optional)"
}
\`\`\`
**Response 201:**
\`\`\`json
{
  "id": "uuid",
  "name": "string",
  "status": "active",
  "createdAt": "ISO8601"
}
\`\`\`
**Errors:** 400 (validation), 401 (unauthenticated), 403 (forbidden)

#### \`GET /api/example/:id\`
_describe_

#### \`PATCH /api/example/:id\`
_describe_

#### \`DELETE /api/example/:id\`
_describe_

### Business Logic

- _Describe non-trivial server-side rules, state machines, computed fields_
- _What happens in edge cases: concurrent writes, partial failures, rollbacks_

### External Services / APIs

| Service | Purpose | SDK / Method |
|---------|---------|--------------|
| _e.g. Stripe_ | _Payment processing_ | _stripe.charges.create_ |
| _e.g. Resend_ | _Transactional email_ | _resend.emails.send_ |

## Admin Integration

_Describe any admin-panel views, data exports, moderation tools, or manual override capabilities needed to support this feature._

## Auth & Permissions

| Role | Can read | Can write | Can delete |
|------|----------|-----------|------------|
| Anonymous | No | No | No |
| Authenticated user | Own records | Own records | Own records |
| Admin | All | All | All |

_Describe any row-level security policies, RBAC rules, or token scoping requirements._

## Edge Cases

1. **Concurrent modification** — _e.g. two users editing same record simultaneously → last-write-wins / optimistic lock_
2. **Large datasets** — _e.g. user has 10,000 items → pagination required, not full load_
3. **Offline / slow network** — _e.g. optimistic update with rollback on failure_
4. **Empty state on first use** — _e.g. show onboarding CTA, not blank page_
5. **Permission boundary** — _e.g. shared link viewed by unauthenticated user_

## Acceptance Tests

- [ ] User can complete the primary flow end-to-end with no console errors
- [ ] Empty state renders correctly with zero data
- [ ] Loading skeleton appears within 100ms of trigger
- [ ] Form validation prevents submission with missing required fields and shows inline errors
- [ ] Network error shows retry option; retry succeeds
- [ ] Mobile layout renders correctly at 375px width
- [ ] Keyboard navigation works without a mouse
- [ ] Admin can view/manage all records; regular user cannot see others' data

## References

| URL | What I learned |
|-----|----------------|
| _https://example.com_ | _Key insight from this source_ |
| _https://example.com_ | _Key insight from this source_ |
| _https://example.com_ | _Key insight from this source_ |
| _https://example.com_ | _Key insight from this source_ |
| _https://example.com_ | _Key insight from this source_ |

---

_Generated by Sneebly Spec Architect. Edit freely — the daemon respects manual changes. Mark a section with \`<!-- locked -->\` at the top to signal the spec is authoritative for that section._
`
