# EvolveAI Database Schema (Cloudflare D1 SQLite)

All user data is strictly isolated by `user_id`. Queries must always bind `user_id` from the verified session.

## Tables
1. `users` — Primary user identity with salted password hash.
2. `sessions` — Opaque session tokens and expiration.
3. `provider_credentials` — Encrypted BYOK credentials (AES-GCM key + IV + masked display).
4. `projects` — Isolated project workspaces with goals and technical stacks.
5. `conversations` — Scoped chat sessions linked to users and optional projects.
6. `messages` — Chat turns with role, content, and provider/model metadata.
7. `memories` — Extracted and categorized personal facts with confidence and status (`candidate`, `approved`, `unverified`, `rejected`, `archived`).
8. `knowledge_entities` — Named concepts, tools, decisions, or goals.
9. `knowledge_relations` — Relational edges between entities.
10. `feedback` — User ratings and explicit correction feedback.
11. `evaluations` — Objective benchmarks measuring memory retrieval and response improvements.
12. `user_preferences` — System configuration flags (e.g. auto memory extraction).
13. `login_attempts` — IP and email brute-force tracking and lockout timestamps.

## Migration History
- `0001_initial_schema.sql`: Core 12 relational tables with foreign keys and indexes.
- `0002_security_and_credentials.sql`: Added `encryption_version` to `provider_credentials` for key rotation, and `login_attempts` table for rate limiting.
