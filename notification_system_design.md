# Stage 1

## REST API Endpoints

**GET /api/notifications?page=1&limit=20&type=Placement&unread=true**

Returns paginated notifications for a student.

```json
{
  "notifications": [
    { "id": "uuid", "type": "Placement", "message": "Google hiring", "isRead": false, "createdAt": "2026-04-22T17:51:30Z" }
  ],
  "total": 150, "page": 1, "limit": 20
}
```

**PATCH /api/notifications/:id/read** — marks one notification as read

**PATCH /api/notifications/read-all** — marks all as read

**POST /api/notifications** — admin creates a notification

```json
{ "type": "Placement", "message": "Amazon hiring", "targetStudentIds": ["all"] }
```

Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`

**GET /api/notifications/unread-count** — returns `{ "unreadCount": 12 }`

## Real-Time Mechanism

SSE (Server-Sent Events) via `GET /api/notifications/stream`. Client opens a persistent connection, server pushes new notifications. Chose SSE over WebSockets because notifications are one-directional and SSE has built-in reconnect.

---

# Stage 2

## DB Choice

PostgreSQL — structured data, need joins and filtering, ACID matters for delivery guarantees.

## Schema

```sql
CREATE TYPE notification_type AS ENUM ('Placement', 'Result', 'Event');

CREATE TABLE students (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    email VARCHAR(150) UNIQUE
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type notification_type NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE student_notifications (
    student_id INT REFERENCES students(id),
    notification_id UUID REFERENCES notifications(id),
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP
);
```

## Scaling Problems

- student_notifications grows fast (notifications × students)
- reads slow down without indexes
- bulk inserts can lock the table

Fix with composite indexes, batch inserts, partitioning by date, and archiving old read notifications.

## Queries

```sql
-- fetch notifications
SELECT n.id, n.type, n.message, n.created_at, sn.is_read
FROM student_notifications sn JOIN notifications n ON sn.notification_id = n.id
WHERE sn.student_id = $1 ORDER BY n.created_at DESC LIMIT $2 OFFSET $3;

-- mark read
UPDATE student_notifications SET is_read = TRUE, read_at = NOW()
WHERE student_id = $1 AND notification_id = $2;

-- mark all read
UPDATE student_notifications SET is_read = TRUE, read_at = NOW()
WHERE student_id = $1 AND is_read = FALSE;

-- unread count
SELECT COUNT(*) FROM student_notifications WHERE student_id = $1 AND is_read = FALSE;
```

---

# Stage 3

## Is the query accurate?

```sql
SELECT * FROM notifications WHERE studentID = 1042 AND isRead = false ORDER BY createdAt DESC;
```

It works but `SELECT *` pulls unnecessary columns and there's no LIMIT.

## Why slow?

No index — full table scan on 5M rows, then sorts everything.

## Fix

```sql
CREATE INDEX idx_student_unread ON notifications (studentID, isRead, createdAt DESC);

SELECT id, type, message, createdAt FROM notifications
WHERE studentID = 1042 AND isRead = false ORDER BY createdAt DESC LIMIT 20;
```

Goes from O(n) scan to O(log n) index lookup.

## Index every column?

No. Each index slows down writes (INSERT/UPDATE must update all indexes) and wastes storage. Only index columns used in WHERE/ORDER BY of frequent queries.

## Placement notifications last 7 days

```sql
SELECT DISTINCT s.id, s.name, s.email FROM students s
JOIN notifications n ON s.id = n.studentID
WHERE n.type = 'Placement' AND n.createdAt >= NOW() - INTERVAL '7 days';
```

---

# Stage 4

DB gets hammered on every page load for 50k students.

**Solution 1 — Redis cache:** Cache per-student notifications with 60s TTL. On cache miss, query DB and store. Invalidate on new notification. Tradeoff: adds Redis dependency, slight staleness within TTL.

**Solution 2 — Cursor pagination:** Return 20 per request, use last timestamp as cursor. Tradeoff: still hits DB every time, just smaller queries.

**Solution 3 — SSE:** Clients don't poll at all, they get pushed. Reduces repeated queries to zero for connected clients.

Best approach: combine all three. Redis for cache, cursor pagination for small queries, SSE for real-time push.

---

# Stage 5

## Problems with current code

- Sequential loop for 50k students = very slow
- No error handling, 200 failed emails are just lost
- No retries
- Email, DB, push are tightly coupled — if email is slow, everything blocks

## Should DB save and email happen together?

No. DB save is fast and reliable. Email is external and can fail. Separate them so in-app notification is always saved regardless of email.

## Redesigned pseudocode

```
function notify_all(student_ids, message):
    notification = create_notification_record(message)
    batches = chunk(student_ids, 500)

    for batch in batches:
        bulk_insert_student_notifications(batch, notification.id)

    for batch in batches:
        enqueue_email_job(batch, message)
        enqueue_push_job(batch, message)

function email_worker():
    while job = dequeue_email_job():
        for student_id in job.batch:
            try: send_email(student_id, job.message)
            catch: add_to_retry_queue(student_id, job.message, attempt=1)

function retry_worker():
    while job = dequeue_retry():
        try: send_email(job.student_id, job.message)
        catch:
            if job.attempt < 3: retry again
            else: move to dead_letter_queue
```

DB saves first in bulk, email/push offloaded to background workers with retry logic.

---

# Stage 6

Using a min-heap of size N to maintain top notifications.

Priority = type weight (Placement=3, Result=2, Event=1) combined with timestamp for recency.

For each notification: if heap has < N items, insert. If score > heap minimum, replace. Otherwise skip. O(n log k) total.

When new notifications come in, just insert into heap — O(log k) per notification.

See `notification_app_be/index.js` for working code.

API: `GET /notifications/top?n=10`
