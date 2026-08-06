import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';

/**
 * Provides JWT access-token validation. Registering {@link JwtStrategy} here
 * makes `JwtAuthGuard` (AuthGuard('jwt')) usable across the app.
 */
@Module({
  imports: [PassportModule],
  providers: [JwtStrategy],
})
export class AuthModule {}
