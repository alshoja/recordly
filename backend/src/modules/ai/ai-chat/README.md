# AI Chat

Public entry point for Recordly AI at `POST /api/ai-chat/message`, plus a
Server-Sent Events variant at `POST /api/ai-chat/message/stream` (Nest `@Sse` with `{ method: RequestMethod.POST }`).

- `AiChatController` validates the request DTO and hands it off.
- `AiChatService` asks for an intent, normalizes untrusted output, and routes by `AiChatIntent`.
- Keep business logic in the routed service, not in this folder.
- Unsupported or malformed intents must return the supported-actions response.
- The stream endpoint emits `delta` events (`{ text }`) while the model writes an answer, then `done` with the full `AiChatResponseDto`, or `error` (`{ message }`). Answers that need no model text send only `done`.
- Streaming is optional per call: pass an `onDelta` handler through to `LlmClient.chat`. Intent classification is never streamed.
- Reverse proxies must not buffer this route (`proxy_buffering off`); Nest's `@Sse` also sends `X-Accel-Buffering: no`.
- When a record search finds nothing and its only filters are free text (name, keyword, email, phone), or a by-name summary finds no record, the same question is answered from indexed document chunks, so names that exist only inside documents are still found. Structured filters (status, city, abroad, and so on) never fall back.
