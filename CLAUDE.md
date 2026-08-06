# Claude Working Constraints

## Allowed Working Directory
All file operations (read, write, edit, create, delete) must stay within **this repository** — the folder containing this `CLAUDE.md`, i.e. the current git working tree.

Do not read from, write to, or modify files outside the repository — even if the user drags in a file path from elsewhere on their machine. Instead, remind them to copy the file into the repo first.

This rule is machine-independent by design: the repo may be checked out at different paths on different collaborators' computers.

## When a File Is Outside This Folder
If the user references or attaches a file from outside the repository:
1. Do NOT access it directly.
2. Politely remind the user: *"Please copy that file into the Moto-Taxi-Regulatory-Map repository first, and I'll work with it from there."*

## What Belongs in This Repository
All files relevant to the Global Moto-Taxi Regulation Atlas project should be copied into the repo before use:
- Any brand assets or reference files
- The PRD.md produced in this project

## Destructive Operations
Never delete or overwrite any file without explicit confirmation from the user.
