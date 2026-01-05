End-to-end encryption (E2E) notes

- This project now performs client-side end-to-end encryption for chat messages.
- Implementation: `public/js/crypto.js` provides AES-GCM key derivation and encrypt/decrypt helpers using Web Crypto API.
- When you select a chat partner, the client prompts for a passphrase for that chat pair. The passphrase is never sent to the server.
- A symmetric key is derived from the passphrase and a salt computed from the pair's IDs. Messages are encrypted with AES-GCM and sent to the server as ciphertext.
- The server (`server.js`) stores and relays ciphertext only; it does not have access to plaintext.

Usage:
1. Start the server as before (`node server.js`).
2. Open the chat UI and select a user. Enter the same passphrase on both sides of the chat to be able to decrypt messages.

Notes & limitations:
- Passphrases are not persisted; refreshing the page requires re-entering the passphrase for each pair.
- This is a simple E2E approach using a shared passphrase per chat pair. For more advanced scenarios (per-message public-key exchange, forward secrecy, group chat key management), integrate libsodium or implement a formal protocol.
- Keep your passphrase secret and share it out-of-band with the chat partner.

New messaging features:
- Reply to a message: click the "Balas" button on any message to set a reply preview, then send — the sent message will include a reply snippet.
- Delete a message: senders can delete their messages with the "Hapus" button; deleted messages are replaced with a notice.
- Delete an entire chat: click "Hapus Obrolan" in the chat header to remove all messages between two users (requires confirmation).

Implementation notes:
- The server exposes socket events `delete-message` and `delete-chat` and updates the message store; it notifies clients to update their UI.
- Reply data (`replyTo` and `replySnippet`) are stored alongside messages so clients can render reply previews when loading history.

External API (for non-browser clients)
-------------------------------------

1) Obtain a JWT token (username & password):

Example (curl):

```bash
curl -X POST http://localhost:3000/api/token \
	-H "Content-Type: application/json" \
	-d '{"username":"alice","password":"secret"}'
```

Response: `{ "token": "<JWT>" }`

2) Send a message using the token:

```bash
curl -X POST http://localhost:3000/api/send-message \
	-H "Content-Type: application/json" \
	-H "Authorization: Bearer <JWT>" \
	-d '{"receiverId":"<otherUserId>","content":"Hello from API","isEncrypted":false}'
```

3) Delete a message (only sender can delete):

```bash
curl -X POST http://localhost:3000/api/delete-message \
	-H "Content-Type: application/json" \
	-H "Authorization: Bearer <JWT>" \
	-d '{"messageId":"<messageId>"}'
```

4) Delete an entire chat with another user:

```bash
curl -X POST http://localhost:3000/api/delete-chat \
	-H "Content-Type: application/json" \
	-H "Authorization: Bearer <JWT>" \
	-d '{"otherUserId":"<otherUserId>"}'
```

Notes:
- API endpoints use Bearer JWT in `Authorization` header. Tokens expire after 7 days by default.
- For encrypted messages, set `isEncrypted:true` and provide ciphertext in `content` (the server treats content as opaque).
- After using the API, clients will receive socket notifications if they are connected (the server emits standard socket events).
