# Domain docs

This repository uses a single-context layout.

## Before exploring the codebase

Read `GLOSSARY.md` at the repository root when it exists.
Read decisions in `docs/adr/` that concern the area you are exploring.

If these files or directories do not exist, proceed silently.
The `domain-modeling` skill creates them when terms or decisions are resolved.

## File locations

- `GLOSSARY.md` holds the repository's domain vocabulary.
- `docs/adr/` holds numbered architecture decision records.

## Use the glossary's vocabulary

Use glossary terms in issue titles, proposals, hypotheses, and test names.
Respect any synonyms the glossary explicitly rules out.

If a needed concept is missing, check whether the project already has a
term for it. Record a real vocabulary gap for `domain-modeling`.

## Flag decision conflicts

If a proposal contradicts an existing ADR, identify the ADR and explain
why the decision should be reconsidered.
