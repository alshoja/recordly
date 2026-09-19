import { Logger, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import type { StoredObjectStream } from '../interfaces/stored-object.interface';

const logger = new Logger('StoredObjectFile');

// Nest does not export the response type its stream error handler receives.
type StreamErrorResponse = Parameters<StreamableFile['errorHandler']>[1];

/**
 * Wraps a stored object for download. Nest's default handler for a failing
 * stream neither logs it nor hides the raw error, so this replaces it: log the
 * error, answer a generic 500 if nothing was sent yet, otherwise cut the
 * connection so the client sees the download as failed.
 */
export function toStreamableFile(
  object: StoredObjectStream,
  { download = false }: { download?: boolean } = {},
): StreamableFile {
  const disposition =
    download && object.originalName
      ? `attachment; filename*=UTF-8''${encodeURIComponent(object.originalName)}`
      : undefined;

  return new StreamableFile(object.body, {
    type: object.contentType,
    length: object.contentLength,
    disposition,
  }).setErrorHandler(handleStreamError);
}

function handleStreamError(
  error: Error,
  streamResponse: StreamErrorResponse,
): void {
  logger.error(`Streaming stored object failed: ${error.message}`, error.stack);

  // Nest types the response as a minimal interface, but at runtime it is the
  // Express response, which is needed for status(), json() and destroy().
  const response = streamResponse as Response;

  if (response.destroyed) {
    return;
  }
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response
    .status(500)
    .json({ statusCode: 500, message: 'An unexpected error occurred.' });
}
