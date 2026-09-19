import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import { useContainer } from 'class-validator';
import { SharedModule } from './shared/shared.module';
import { AllHttpExceptionFilter } from './shared/filter/http-exception.filter';

async function bootstrap() {
  // Production logs are one JSON object per line, without debug output, so a
  // log collector can parse them. Development keeps Nest's default logger.
  const app = await NestFactory.create(AppModule, {
    logger:
      process.env.NODE_ENV === 'production'
        ? new ConsoleLogger({
            json: true,
            logLevels: ['log', 'warn', 'error', 'fatal'],
          })
        : undefined,
  });
  const configService = app.get(ConfigService);
  const appConfig = configService.get<{
    port: number;
    isDevelopment: boolean;
    corsOrigins: string[];
  }>('config');

  const isDevelopment = appConfig?.isDevelopment ?? true;
  const corsOrigins = appConfig?.corsOrigins ?? [];
  
  app.enableCors(
    isDevelopment
      ? true
      : {
          origin: corsOrigins,
        },
  );
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      forbidNonWhitelisted: true,
      whitelist: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.useGlobalFilters(new AllHttpExceptionFilter(app.get(HttpAdapterHost)));
  useContainer(app.select(SharedModule), { fallbackOnErrors: true });
  app.setGlobalPrefix('api');
  await app.listen(appConfig?.port ?? 5001);
}
bootstrap();
