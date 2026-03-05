import {
  Controller,
  Get,
  Post,
  Param,
  Sse,
  UseGuards,
  MessageEvent,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable, interval, map, merge } from 'rxjs';
import { PaymentSessionsService } from './payment-sessions.service';
import { CurrentUser } from '../common/decorators';

@Controller('payment-sessions')
export class PaymentSessionsController {
  constructor(private paymentSessionsService: PaymentSessionsService) {}

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  findOne(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.paymentSessionsService.findOne(id, userId);
  }

  @Sse(':id/events')
  sessionEvents(@Param('id') id: string): Observable<MessageEvent> {
    // Heartbeat every 30s to keep connection alive
    const heartbeat$ = interval(30000).pipe(
      map(
        () =>
          ({
            data: JSON.stringify({
              type: 'heartbeat',
              timestamp: new Date().toISOString(),
            }),
          }) as MessageEvent,
      ),
    );

    const sessionUpdates$ = this.paymentSessionsService
      .getSessionStream(id)
      .pipe(map((event) => ({ data: event.data }) as MessageEvent));

    return merge(heartbeat$, sessionUpdates$);
  }

  @Post(':id/cancel')
  @UseGuards(AuthGuard('jwt'))
  cancel(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.paymentSessionsService.cancel(id, userId);
  }
}
