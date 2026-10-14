import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configModuleOptions } from './config/configuration';

@Module({
  imports: [ConfigModule.forRoot(configModuleOptions)],
})
export class AppModule {}
