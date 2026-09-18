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
