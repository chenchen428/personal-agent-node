# Personal Agent modifications

Upstream: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
Revision: `f8ac5e1266dba8354ea96e19994d9f4345e7ec31`
Adapted: 2026-07-16

Personal Agent changed `SKILL.md` to invoke the bundled search script from `skills/ui-ux-pro-max/`, added a no-Python fallback, prohibited unapproved dependency installation, and added `agents/openai.yaml`. `scripts/design_system.py` now detects terminal color support without reading the process environment.
