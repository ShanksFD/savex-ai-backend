import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as Sentry from '@sentry/nestjs';
import axios from 'axios';
import { TransactionStatus } from '@prisma/client';

@Injectable()
export class ZohoService {
  private readonly logger = new Logger(ZohoService.name);
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const accountsUrl = this.configService.get<string>(
      'ZOHO_ACCOUNTS_URL',
      'https://accounts.zoho.com',
    );

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.configService.get<string>('ZOHO_CLIENT_ID', ''),
      client_secret: this.configService.get<string>('ZOHO_CLIENT_SECRET', ''),
      refresh_token: this.configService.get<string>('ZOHO_REFRESH_TOKEN', ''),
    });

    const res = await axios.post(
      `${accountsUrl}/oauth/v2/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    this.accessToken = res.data.access_token;
    this.tokenExpiresAt = Date.now() + res.data.expires_in * 1000;
    return this.accessToken!;
  }

  private async computeContactData(userId: string) {
    const [user, txAgg] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          addedAmount: true,
        },
      }),
      this.prisma.transaction.aggregate({
        where: { userId, status: TransactionStatus.COMPLETED },
        _sum: { usdAmount: true, totalTokens: true },
        _count: { id: true },
      }),
    ]);

    if (!user) throw new Error(`User ${userId} not found`);

    const amountInvestedUsd = txAgg._sum.usdAmount ?? 0;
    const tokensFromTx = txAgg._sum.totalTokens ?? 0;
    const addedAmountSvx = user.addedAmount ?? 0;

    const sanitizedPhone = (user.phone ?? '').replace(/[^\d+\s\-().]/g, '').trim();

    return {
      First_Name: user.firstName ?? '',
      Last_Name: user.lastName ?? '',
      Email: user.email,
      Phone: sanitizedPhone,
      Investor_Status: txAgg._count.id > 0 ? 'Investor' : 'Non-Investor',
      Amount_Invested_USD: amountInvestedUsd,
      Total_Tokens_Owned: tokensFromTx + addedAmountSvx,
      Added_Amount_SVX: addedAmountSvx,
    };
  }

  async upsertContact(userId: string): Promise<void> {
    try {
      const [payload, token] = await Promise.all([
        this.computeContactData(userId),
        this.getAccessToken(),
      ]);

      const baseUrl = this.configService.get<string>(
        'ZOHO_BASE_URL',
        'https://www.zohoapis.com',
      );
      const headers = { Authorization: `Zoho-oauthtoken ${token}` };

      const searchRes = await axios.get(
        `${baseUrl}/crm/v2/Contacts/search`,
        {
          params: { criteria: `(Email:equals:${payload.Email})` },
          headers,
          validateStatus: (s) => s < 500,
        },
      );

      const existing = searchRes.status !== 204 && searchRes.data?.data?.length > 0
        ? searchRes.data.data[0]
        : null;

      if (existing) {
        const res = await axios.put(
          `${baseUrl}/crm/v2/Contacts/${existing.id}`,
          { data: [payload] },
          { headers },
        );
        const record = res.data?.data?.[0];
        if (record?.status === 'error') {
          const msg = `Zoho Contact update rejected for user ${userId}: ${JSON.stringify(record)}`;
          this.logger.error(msg);
          Sentry.captureException(new Error(msg), { tags: { userId, zohoAction: 'update' } });
        } else {
          this.logger.log(`Zoho Contact updated for user ${userId}`);
        }
      } else {
        const res = await axios.post(
          `${baseUrl}/crm/v2/Contacts`,
          { data: [payload] },
          { headers },
        );
        const record = res.data?.data?.[0];
        if (record?.status === 'error') {
          const msg = `Zoho Contact creation rejected for user ${userId}: ${JSON.stringify(record)}`;
          this.logger.error(msg);
          Sentry.captureException(new Error(msg), { tags: { userId, zohoAction: 'create' } });
        } else {
          this.logger.log(`Zoho Contact created for user ${userId}`);
        }
      }
    } catch (err: any) {
      this.logger.error(
        `Zoho upsert failed for user ${userId}: ${
          err?.response?.data ? JSON.stringify(err.response.data) : err.message
        }`,
      );
      Sentry.captureException(err, { tags: { userId, zohoAction: 'upsert' } });
    }
  }
}
