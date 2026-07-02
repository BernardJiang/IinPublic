# Deleted talk-delivery routes return 404 (mesh migration smoke test)

Verifies that removed server endpoints POST /api/talks/:id/received and GET /api/incoming-talks return 404. Confirms that /health and GET /api/talks/:id still return 200/202 to ensure partial cutover is clean.
