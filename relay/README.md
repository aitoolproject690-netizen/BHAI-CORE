# BHAI-RELAY

Standalone public relay for BHAI-CORE and the BHAI Mobile Node.

## Protocol

Mobile Node connects over WebSocket:

- `GET /v1/mobile-node`
- first message: `{"type":"auth","token":"<node token>"}`
- server replies: `{"type":"auth_ok"}`

BHAI-CORE sends authenticated HTTP requests:

- `POST /v1/relay/request`
- header: `Authorization: Bearer <client token>`
- JSON body: `{ "method", "path", "headers", "body" }`

The relay forwards requests to the currently authenticated mobile node and waits for its response.

## Environment

- `BHAI_RELAY_STANDALONE=true`
- `BHAI_RELAY_NODE_TOKEN=<secret>`
- `BHAI_RELAY_CLIENT_TOKEN=<secret>`
- `HOST=0.0.0.0`
- `PORT=18090`

No engine key is logged or forwarded by the relay.
