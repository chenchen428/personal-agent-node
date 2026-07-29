---
name: personal-bug-report
description: Draft, de-duplicate, submit, comment on, and verify public GitHub bug reports for Personal Agent Node using the customer's active GitHub CLI identity. Use when the user asks to report a Node bug, submit product feedback, create an issue, or add evidence to an existing public issue.
---

# Personal Bug Report

Use the current customer's `gh` authentication. Do not create a Cloud ticket, new product capability, or hidden report.

Collect the smallest reproducible, redacted report. Exclude credentials, cookies, private paths, customer content, raw logs, email addresses, tokens, and unpublished repository details. Search open and closed issues before drafting.

Creating or commenting on a public issue is R2. Show the exact public title/body or comment and target issue for confirmation, then submit idempotently and verify the returned repository, issue number, and public URL.

Read [bug-report.md](references/bug-report.md) for preflight, de-duplication, redaction, confirmation, submission, and verification.
