# Bruno Collection

Path: `bruno/job-autofill-agent`

## Use

1. Open Bruno
2. Open collection folder: `job-autofill-agent/bruno/job-autofill-agent`
3. Select environment: `local`
4. Run in order:
   - Health Check
   - Signup (or Login)
   - Update Me
   - Upload Resume
   - Parse Resume
   - Autofill (production auth profile)
   - Autofill (MVP unauth payload mode) [optional]

## Notes

- `Signup` and `Login` tests auto-save JWT into `{{token}}`.
- Set `resumePath` in `environments/local.bru` before `Upload Resume`.
- Production flow should use `Autofill (production auth profile)` so profile is resolved from auth token + DB.
- `Autofill (MVP unauth payload mode)` is only for unauthenticated fallback testing.
