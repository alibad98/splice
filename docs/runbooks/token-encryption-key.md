# Platform token encryption key and store disconnects

Owner: integration. Applies to `TOKEN_ENCRYPTION_KEY` (apps/api) and the `integration.store.disconnected` event.

## Generate or rotate the master key

1. Generate 32 random bytes, base64 encoded: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. Store it in the secret manager only. Never commit it, paste it in chat or print it in logs (the API redacts `token`/`secret` keys, but a pasted value elsewhere is not covered).
3. Set `TOKEN_ENCRYPTION_KEY` and a new `TOKEN_ENCRYPTION_KEY_ID` (for example `k2`) on both roles.
4. Rotation is not automated yet: the cipher decrypts any configured key id but the env carries one key. Until the multi-key config lands (deferred), changing the key without re-encrypting makes every stored token unreadable and every store needs to reinstall.

## A store shows "disconnected"

- Cause: Salla rejected the refresh token for good (revoked, expired, or already used), so `integration.getAccessToken` moved the store to `disconnected` and emitted `integration.store.disconnected`.
- The merchant fixes it by installing again from the Salla App Store (the OAuth flow restores the same store row and stores a new token pair).
- Check `token_access_log` (purpose `refresh`, outcome `rejected`) for the time of the failure. The log holds no token values.
