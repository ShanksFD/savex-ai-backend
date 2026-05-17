import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Headers,
  Sse,
  UseGuards,
  Req,
  MessageEvent,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Observable, interval, map, merge } from "rxjs";
import {
  PaymentSessionsService,
  SessionCaller,
} from "./payment-sessions.service";
import { CurrentUser } from "../common/decorators";
import { Request } from "express";

// Build a SessionCaller from either a JWT-authenticated user OR an X-Claim-Token header.
// Used on endpoints that need to serve both authenticated users (dashboard) and
// guest buyers in the Buy Now flow before they have registered.
function resolveCaller(
  userId: string | undefined,
  claimToken: string | undefined,
): SessionCaller {
  if (userId) return { userId };
  if (claimToken && claimToken.length > 0) return { claimToken };
  throw new UnauthorizedException("Authentication or claim token required");
}

// Lightweight extraction: try to read the JWT user if present, but do not throw
// if absent — that way the same endpoint can serve guests with a claim token.
// We rely on Passport already populating req.user when a valid Bearer token is
// supplied via the OptionalJwtAuthGuard below.
class OptionalJwtAuthGuard extends AuthGuard("jwt") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRequest(err: any, user: any) {
    return user || null;
  }
}

@Controller("payment-sessions")
export class PaymentSessionsController {
  constructor(private paymentSessionsService: PaymentSessionsService) {}

  @Get(":id")
  @UseGuards(OptionalJwtAuthGuard)
  findOne(
    @Param("id") id: string,
    @Req() req: Request,
    @Headers("x-claim-token") claimToken?: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req.user as any)?.id as string | undefined;
    return this.paymentSessionsService.findOne(
      id,
      resolveCaller(userId, claimToken),
    );
  }

  @Sse(":id/events")
  sessionEvents(@Param("id") id: string): Observable<MessageEvent> {
    const heartbeat$ = interval(30000).pipe(
      map(
        () =>
          ({
            data: JSON.stringify({
              type: "heartbeat",
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

  @Post(":id/cancel")
  @UseGuards(OptionalJwtAuthGuard)
  cancel(
    @Param("id") id: string,
    @Req() req: Request,
    @Headers("x-claim-token") claimToken?: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req.user as any)?.id as string | undefined;
    return this.paymentSessionsService.cancel(
      id,
      resolveCaller(userId, claimToken),
    );
  }

  @Patch(":id/payment-method")
  @UseGuards(OptionalJwtAuthGuard)
  markPaymentMethod(
    @Param("id") id: string,
    @Req() req: Request,
    @Body()
    body: { paymentMethod: "wallet" | "manual"; walletAddress?: string },
    @Headers("x-claim-token") claimToken?: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req.user as any)?.id as string | undefined;
    return this.paymentSessionsService.markPaymentMethod(
      id,
      resolveCaller(userId, claimToken),
      body.paymentMethod,
      body.walletAddress,
    );
  }

  @Post(":id/recover-claim-token")
  recoverClaimToken(
    @Param("id") id: string,
    @Body()
    body: {
      walletAddress: string;
      message: string;
      signature: string;
    },
  ) {
    if (!body.walletAddress || !body.message || !body.signature) {
      throw new BadRequestException(
        "walletAddress, message, and signature are required",
      );
    }
    return this.paymentSessionsService.recoverClaimToken(
      id,
      body.walletAddress,
      body.message,
      body.signature,
    );
  }
}
