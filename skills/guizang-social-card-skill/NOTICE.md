# Personal Agent modifications

Upstream: https://github.com/op7418/guizang-social-card-skill
Revision: `cf4b810fac1c73fb65a2bb31d8c9278d82cbc4c5`
Adapted: 2026-07-16

Personal Agent changed `SKILL.md` to use the customer `publications/` directory, point to the installed validator path, make Playwright optional and approval-gated, and require rights verification before downloading third-party images. The upstream validator was relocated to `scripts/validate-social-deck.mjs`. Agent UI metadata is retained.
