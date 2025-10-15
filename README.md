# Offer routing system

Project to handle multiple lead-generation websites that send user submissions and redirects it to different partner APIs (schools, finance offers, etc.) based on user defined rules.

## Stack

- Supabase Queues, Database and edge functions
- Deno (typescript) for edge functions
- Sentry for logging and monitoring

## Entrypoints
- /api/submit (Function): Ingestion endpoint.
- /api/rules (Function): Backend function to accept rule updates from the admin UI.

## Queues (PGMQ)
- Submission Queue: Buffers incoming submissions post-initial validation.
- Submission DLQueue: Dead-letter for failed submission processing.
- Routing Queue: Buffers items awaiting routing decisions.
- Compile Queue: Triggers compilation when rules change.
- Dealer Queue: Work queue for Dealer X delivery.
- Dealer DLQueue: Dead-letter for Dealer X delivery failures.

## Core functions/services
- Identify lead (Function):
    - Reads from Submission Queue and uniquely identify client from lead using email, full name or phone
    - If email or phone already exist then assume its the same person even if the other props are different
    - If person does not exist it will crate it
        - Else if the person exist but the third prop is different I want to persist the prop in a new record and set an 'alias' column (optional otherwise) to point to the origin record (so a person can have as single main record and multiple aliases poining to this one)
        - Else If the data is the same for all properties we continue to the next instruction
    - In all cases we obtain the id of the person and set it to the message, replacing the user info by the id and (optional) the alias used for this operation
    - Lastly, enqueue the updated message to the next step queue and mark it as completed (delete) in Submission Queue.
    - Outputs to: Routing Queue
    - Implement a retry logic with maximum N intents
    - On failed retry outputs to: Submission DLQueue and mark it as completed (delete) in Submission Queue.
    - Emits metrics to Sentry.
        - Time taken per lead and per batch
        - Errors
- Router (Function):
    - Reads from Routing Queue.
    - Uses compiled decision Tree which is a js string that its evaluated/loaded once as part of the startup and its used to decide the route to follow depending on the compiled predicates.
    - Depending on the decision tree result we redirect the message to ***<dealer>_queue*** queue and mark it as completed (delete) in Routing Queue.
    - Implement a retry logic with maximum N intents
    - On failed retry outputs to: Routing DLQueue and mark it as completed (delete) in Routing Queue
    - Emits metrics to Sentry.
        - Time taken per route and per batch
        - Errors
- Handler + Dedupe (Function):
    - Reads from Dealer Queue.
    - Uses a custom dedupe function for the Dealer(Loaded at startup from Table)
        - It returns a custom string key that identifies the record used to match the table for duplicates
            - If a duplicate is found it returns duplicate response
        - If its not a duplicate then we return valid response
    - When its a duplicate we log it to sentry and just mark the record as completed (delete) in Routing Queue.
    - When its a valid lead
        - Persist message data to Leads store with pending state and request_date.
        - Consults Circuit breaker Cache for open circuit or retry time
            - Then call custom parter function passing the message as argument. This fn is in charge of calling the client and supply the data.
        - On success:
            - Update the record state with the response status
            - If circuit breaker was open then close the status as its working
            - Emit the response data and status to sentry
        - On error:
            - Retry logic with maximum N intents (Configurable by a record in dealer fn and config table with default value of 3)
            - We update the record state with the error
            - Emit the response data, status and retry count to sentry
            - On failed retries
                - Move messages to Dealer DLQueue
                - Mark it as completed (delete) in Dealer Queue
                - Open cirtuit breaker and depending on response code set the retry time
    - Emits to Sentry.
        - Time taken per lead and per batch
        - Errors
- Rule Compiler (Function):
    - Reads from Compile Queue.
    - Once started it will read all the rules from rules table and dynamically generate JS code witht the predicates that forms the decision tree and persists the string in to a record (or file) that will be loaded by the router function at startup and used to route the lead.
    - It does an analisys of the rules and their constraints to build be most performant tree fo decisions
    - As part of the analsys it also finds conflicting/duplicate rules (that are equivalent and route to same or different next step)
- Queue metrics (Function):
    - Reads metrics using PGMQ.
    - Emits metrics to Sentry.
    
## Data stores
- Rules (datastore): Authoritative rule definitions.
- Dealer Functions (datastore): Stores dedupe and call functions
- Decision Tree (datastore): Compiled/optimized routing structure.
- Lead Identity (datastore): Lead identity graph and alias.
- Leads (datastore): Persisted submitted leads.
- Circuit breaker (datastore): Availability/failure state for dealer integrations.

## External services and labels
- Dealer API: Downstream dealer endpoint.
- Sentry (Logs + Dashboard): Centralized logging/monitoring.

## Unit  tests

- Identify lead
- Router using decision tree
- Rule Compiler to build a valid and correct desicion tree

## Integration tests

- a happy path flow from start to calling dealer x API
- a duplicate lead flow
- a non duplicate lead flow but with an alias
- a API limit reached flow
- Per dealer custom implementation test for duplicate leads
