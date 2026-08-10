# Classic Trip v1.6.39 — Partner signup stabilization

- Partner operating currency is derived server-side from the selected country.
- Partner signup no longer depends on hidden browser fields to produce valid server data.
- Partner form values are preserved after failed submissions.
- Partner onboarding errors are logged with their actual code/status and return a safe, useful partner-specific message.
- A session-store regeneration failure after account creation no longer makes a successful signup look failed.
- Verification review and audit initialization are recoverable secondary work; temporary failures no longer roll back an otherwise valid partner account.
- Company wallet initialization is recoverable; settlement/verification can create it idempotently later if the initial secondary write is temporarily unavailable.
