# Troubleshooting

## Common issues
### License gate failure
- confirm a LICENSE file exists
- confirm it is MIT-compatible

### Git acquisition problems
- confirm `git` is installed
- confirm the source URL is valid

### Install verification failure
- inspect `install-manifest.json`
- inspect `verify-report.json`
- consider using `rollback <run-id>`

### Nested local workspace issue
This is already handled by staging-based local snapshot logic, but if local copying behaves strangely, verify the workspace path and run directory layout.
