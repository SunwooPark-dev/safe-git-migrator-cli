# Safety Model

## Hard constraints
- Windows only for v1
- MIT-only inputs for v1
- no billed API usage
- backup before install mutation
- rollback support required

## Why this matters
The CLI is intended for safe repository reuse, so it should fail closed on unclear license state and preserve reversibility when touching install targets.
