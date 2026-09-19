import {
  ClassSerializerInterceptor,
  Controller,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';

import { AppService } from './app.service';
import { UploadInterceptor } from './shared/interceptors/file-upload.interceptor';
import { Throttle } from '@nestjs/throttler';
import { MimeTypeFileValidator } from './shared/validators/mime-type-file.validator';
import { StorageService } from './shared/services/storage.service';
import { TRANSIENT_BUCKET } from './shared/constants/storage.constants';
import { AuthenticatedRequest } from './modules/auth/types/express';
import { toStreamableFile } from './shared/utilities/stored-object-file.utility';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly storageService: StorageService,
  ) { }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post('uploads/profile-staging')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UseInterceptors(UploadInterceptor('file'), ClassSerializerInterceptor)
  async uploadProfileStaging(
    @Req() request: AuthenticatedRequest,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 2 * 1024 * 1024 }),
          new MimeTypeFileValidator({
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg'],
          }),
        ],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
  ) {
    const key = this.storageService.createProfileStagingKey(
      request.user.sub,
      file.originalname,
    );
    await this.storageService.upload(TRANSIENT_BUCKET, key, file);
    return {
      url: `/api/uploads/profile-staging/${key.split('/').pop()}`,
    };
  }

  @Get('uploads/profile-staging/:uploadId')
  async getProfileStaging(
    @Req() request: AuthenticatedRequest,
    @Param('uploadId') uploadId: string,
  ) {
    const reference = this.storageService.toReference(
      TRANSIENT_BUCKET,
      `profile-staging/users/${request.user.sub}/${uploadId}`,
    );
    return toStreamableFile(await this.storageService.get(reference));
  }
}
