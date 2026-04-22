# Architecture

## Pipeline
1. normalize source
2. acquire source (local copy or cached git clone/fetch)
3. enforce MIT-only gate
4. classify artifacts
5. transform through target adapters
6. optionally install
7. verify
8. rollback if needed

## Main code paths
- `src/cli.js`
- `src/lib/runner.js`
- `tests/cli.test.js`

## Design choice
This CLI favors a shared core with target-specific mapping rather than duplicated per-target command logic.
