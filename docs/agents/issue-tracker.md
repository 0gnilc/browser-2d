# GitHub issue tracker

Issues and specs live in https://github.com/0gnilc/browser-2d/issues.
Use the `gh` CLI.

## Target repository

Run commands inside this clone. Before the first write in a session, run
`gh repo view --json nameWithOwner` and verify `0gnilc/browser-2d`.

Append `--repo 0gnilc/browser-2d` to every `gh issue` or `gh pr` command below.
File issues in this repository, never in the skills' upstream repository.

## Issue operations

- Create: `gh issue create --title "<title>" --body-file <file>`.
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,body,labels,comments`.
  Apply label and state filters as needed.
- Edit the body: `gh issue edit <number> --body-file <file>`.
- Comment: `gh issue comment <number> --body-file <file>`.
- Apply a label: `gh issue edit <number> --add-label "<label>"`.
- Remove a label: `gh issue edit <number> --remove-label "<label>"`.
- Close: post the explanation as a separate comment, then run
  `gh issue close <number>`.

Use a UTF-8 file for multiline bodies and comments.
Read `docs/agents/triage-labels.md` before applying triage labels.

## Parent issues and blockers

The installed `gh` supports native sub-issues and dependencies.

- Create a child with `gh issue create --parent <parent> --title "<title>" --body-file <file>`.
- Link an existing child with `gh issue edit <parent> --add-sub-issue <child>`.
- Add a blocker with `gh issue edit <child> --add-blocked-by <blocker>`.
- Count open blockers with
  `gh api repos/0gnilc/browser-2d/issues/<number> --jq .issue_dependencies_summary.blocked_by`.

If native relationships are unavailable, add `Part of #<parent>` and
`Blocked by: #<number>` lines to the child body. Add the child to the
parent's task list. A ticket is unblocked when every blocker is closed.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill terminology

"Publish to the issue tracker" means create a GitHub issue.
"Fetch the relevant ticket" means read the GitHub issue.

For `/wayfinder`, use one issue labelled `wayfinder:map` with child issues.
Label children `wayfinder:research`, `wayfinder:prototype`,
`wayfinder:grilling`, or `wayfinder:task`.
Select the first open, unassigned child in map order with no open blockers.
Claim it with `gh issue edit <number> --add-assignee @me`.
To resolve it, comment with the result, close the child, and add a summary
and link to the map's Decisions-so-far section.
