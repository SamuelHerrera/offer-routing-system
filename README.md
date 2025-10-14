# Offer routing system

Project to handle multiple lead-generation websites that send user submissions and redirects it to different partner APIs (schools, finance offers, etc.) based on user defined rules.

## Stack

- Deno for edge functions (Supabase)
- Supabase Queues
- Supabase Database
- Sentry for logging and monitoring
- Redis for caching circuit breaker states