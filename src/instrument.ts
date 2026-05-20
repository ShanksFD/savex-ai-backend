import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.APP_ENV ?? 'development',
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: 0.2,
  profilesSampleRate: 0.2,
  sendDefaultPii: true,
  beforeSend(event) {
    if (event.exception?.values?.[0]?.value === 'Unauthorized') {
      return null;
    }
    return event;
  },
});
