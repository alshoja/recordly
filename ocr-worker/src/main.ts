import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

const logger = new Logger('OcrWorker');

// Production logs are one JSON object per line, without debug output, so a
// log collector can parse them. Development keeps Nest's default logger.
function createWorkerLogger(): ConsoleLogger | undefined {
  if (process.env.NODE_ENV !== 'production') {
    return undefined;
  }

  return new ConsoleLogger({
    json: true,
    logLevels: ['log', 'warn', 'error', 'fatal'],
  });
}

async function bootstrap() {
  // The process is in an unknown state after an unhandled rejection or an
  // uncaught exception: log it, then exit so Docker restarts the worker.
  process.on('unhandledRejection', (reason) => {
    logger.error(
      `Unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
      reason instanceof Error ? reason.stack : undefined,
    );
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught exception: ${error.message}`, error.stack);
    process.exit(1);
  });

  await NestFactory.createApplicationContext(WorkerModule, {
    logger: createWorkerLogger(),
  });
  logger.log('OCR worker started and listening to the queue.');
}

bootstrap().catch((error: unknown) => {
  logger.error(
    `OCR worker failed to start: ${error instanceof Error ? error.message : String(error)}`,
    error instanceof Error ? error.stack : undefined,
  );
  process.exit(1);
});
