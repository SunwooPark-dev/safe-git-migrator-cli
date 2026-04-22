# Command Reference

## inspect
Purpose:
- inventory source artifacts
- verify license gate
- avoid install/transform side effects

## dry-run
Purpose:
- classify artifacts
- generate target outputs
- skip installation

## apply
Purpose:
- acquire source
- classify and transform
- install outputs
- generate backup and install manifests

## verify
Purpose:
- confirm installed outputs exist according to the install manifest

## rollback
Purpose:
- restore from install manifest and backups
