# Lessons

- When duplicate helper logic appears in the same module (especially conversions), extract it to a shared utility immediately instead of keeping local duplicates.
- Before finalizing refactors, scan for repeated lambda/function bodies with `rg` and consolidate them.
