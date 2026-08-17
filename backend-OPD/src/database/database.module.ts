import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { models } from './models';

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const db = config.get('database');
        return {
          dialect: 'postgres',
          host: db.host,
          port: db.port,
          username: db.user,
          password: db.password,
          database: db.name,
          logging: db.logging ? console.log : false,
          autoLoadModels: true,
          synchronize: false, // schema owned by migrations, never sync
          models,
          dialectOptions: db.ssl
            ? { ssl: { require: true, rejectUnauthorized: false } }
            : {},
        };
      },
    }),
  ],
})
export class DatabaseModule {}
