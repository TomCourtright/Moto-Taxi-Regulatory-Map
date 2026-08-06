# Claude Working Constraints

## Allowed Working Directory
All file operations (read, write, edit, create, delete) must stay within:

**`C:\Users\tomrc\OneDrive\Desktop\Boda Book\Consultancy\GNPT\Boda Boda Regulation - 2025-26\Map Part\Global Moto Taxi Regulation Map - for Claude`**

Do not read from, write to, or modify files in any other folder on this machine — even if the user drags in a file path from elsewhere. Instead, remind the user to copy the file into the working directory first.

## When a File Is Outside This Folder
If the user references or attaches a file from outside this directory:
1. Do NOT access it directly.
2. Politely remind the user: *"Please copy that file into the Global Moto Taxi Regulation Map folder first, and I'll work with it from there."*

## What Belongs in This Folder
All files relevant to the Global Moto Taxi Regulation Map project should be copied here before use:
- Any brand assets or reference files
- The PRD.md produced in this project

## Destructive Operations
Never delete or overwrite any file without explicit confirmation from the user.
