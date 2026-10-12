# Workers

Background processing belongs here. Screening and email workers will consume durable database-backed jobs or an explicitly selected queue implementation. Workers must be idempotent, retryable, observable, and separate from the API request lifecycle.