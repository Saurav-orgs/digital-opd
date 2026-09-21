import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { UsersService } from '../users/users.service';
import { JwtPayload } from '../auth/jwt.strategy';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { PermissionAction, PermissionModule, UserType } from '../common/enums';
import { ConsultationStreamService } from './consultation-stream.service';

/** What a `start`/`segment`/`stop` reply looks like when the call is refused. */
type Refusal = { ok: false; message: string; fatal: boolean };

/**
 * The live-transcription socket: `/consultation`.
 *
 * One connection per open recorder. The doctor's JWT rides in the handshake
 * (`auth.token`) and is checked once, in a connection middleware, the way the
 * HTTP guard checks it on every request. Middleware rather than
 * `handleConnection` because the latter runs alongside the first messages —
 * the user lookup is async, and a `start` sent straight after connecting was
 * arriving before it had finished. A connection without a usable token is
 * refused outright; the client sees `connect_error` and falls back.
 *
 * Every event is acknowledged so the client can tell "not delivered" from
 * "delivered and refused". A refusal marked `fatal` means streaming is not
 * available for this recording and the client should keep the audio and
 * upload it the old way when the doctor stops.
 */
@WebSocketGateway({
  namespace: '/consultation',
  // Segments are a few seconds of 16 kHz PCM — well under this, but a doctor
  // who never pauses produces 20 s pieces (~640 KB), and the default 1 MB cap
  // is closer to that than is comfortable.
  maxHttpBufferSize: 4 * 1024 * 1024,
  cors: { origin: true, credentials: true },
})
export class ConsultationsGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly logger = new Logger(ConsultationsGateway.name);
  private readonly enabled: boolean;

  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly stream: ConsultationStreamService,
    config: ConfigService,
  ) {
    const ai = config.get<{ enabled: boolean; streaming: boolean }>('ai')!;
    this.enabled = ai.enabled && ai.streaming;
  }

  afterInit(server: Namespace): void {
    server.use(async (client, next) => {
      // Turned off by config: refuse every connection and the recorder falls
      // back to uploading the whole recording, with no client change needed.
      if (!this.enabled) {
        next(new Error('Live transcription is off on this server.'));
        return;
      }

      const token = (client.handshake.auth as { token?: unknown })?.token;
      let user: AuthUser | null = null;
      try {
        if (typeof token === 'string' && token) {
          const payload = this.jwt.verify<JwtPayload>(token);
          user = await this.users.buildAuthUser(payload.sub);
        }
      } catch {
        user = null;
      }

      if (!user || !this.mayRecord(user)) {
        next(new Error('Not signed in.'));
        return;
      }
      client.data.user = user;
      next();
    });
  }

  handleDisconnect(client: Socket): void {
    this.stream.disconnected(client);
  }

  @SubscribeMessage('start')
  async onStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { appointmentId?: string },
  ): Promise<{ ok: true; sessionId: string } | Refusal> {
    const user = client.data.user as AuthUser;
    if (!body?.appointmentId) return this.refuse('No appointment given.', true);
    try {
      const { sessionId } = await this.stream.start(body.appointmentId, user, client);
      client.data.sessionId = sessionId;
      return { ok: true, sessionId };
    } catch (err) {
      this.logger.warn(`Live consultation refused for ${body.appointmentId}: ${(err as Error).message}`);
      return this.refuse((err as Error).message || 'Could not start.', true);
    }
  }

  @SubscribeMessage('segment')
  onSegment(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { seq?: number; wav?: Buffer | ArrayBuffer },
  ): { ok: true } | Refusal {
    const sessionId = client.data.sessionId as string | undefined;
    if (!sessionId) return this.refuse('No recording in progress.', true);
    if (typeof body?.seq !== 'number' || !body.wav) return this.refuse('Bad segment.', false);
    const wav = Buffer.isBuffer(body.wav) ? body.wav : Buffer.from(body.wav);
    this.stream.segment(sessionId, body.seq, wav);
    return { ok: true };
  }

  @SubscribeMessage('stop')
  onStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { totalSegments?: number },
  ): { ok: true } | Refusal {
    const sessionId = client.data.sessionId as string | undefined;
    if (!sessionId) return this.refuse('No recording in progress.', true);
    if (typeof body?.totalSegments !== 'number') return this.refuse('Bad stop.', false);
    this.stream.stop(sessionId, body.totalSegments);
    client.data.sessionId = undefined;
    return { ok: true };
  }

  @SubscribeMessage('abort')
  async onAbort(@ConnectedSocket() client: Socket): Promise<{ ok: true }> {
    const sessionId = client.data.sessionId as string | undefined;
    client.data.sessionId = undefined;
    if (sessionId) await this.stream.abort(sessionId);
    return { ok: true };
  }

  /** The same grant `POST consultation/audio` asks for. */
  private mayRecord(user: AuthUser): boolean {
    if (user.type === UserType.SUPER_ADMIN) return true;
    return (user.permissions ?? []).includes(
      `${PermissionModule.APPOINTMENTS}:${PermissionAction.UPDATE}`,
    );
  }

  private refuse(message: string, fatal: boolean): Refusal {
    return { ok: false, message, fatal };
  }
}
