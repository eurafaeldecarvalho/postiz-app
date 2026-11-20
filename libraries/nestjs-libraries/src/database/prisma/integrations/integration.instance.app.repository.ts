import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export type InstanceAppKey = {
  provider: string;
  instanceUrl: string;
  redirectUri: string;
};

@Injectable()
export class IntegrationInstanceAppRepository {
  constructor(
    private _instanceApp: PrismaRepository<'integrationInstanceApp'>
  ) {}

  get(key: InstanceAppKey) {
    return this._instanceApp.model.integrationInstanceApp.findUnique({
      where: { provider_instanceUrl_redirectUri: key },
    });
  }

  // Keeps the app that is already stored: two channels connecting to a new
  // instance at the same time both register an app, but only the first one is
  // kept, so the authorize url and the token exchange use the same client.
  create(key: InstanceAppKey, clientId: string, clientSecret: string) {
    return this._instanceApp.model.integrationInstanceApp.upsert({
      where: { provider_instanceUrl_redirectUri: key },
      create: { ...key, clientId, clientSecret },
      update: {},
    });
  }

  replace(key: InstanceAppKey, clientId: string, clientSecret: string) {
    return this._instanceApp.model.integrationInstanceApp.update({
      where: { provider_instanceUrl_redirectUri: key },
      data: { clientId, clientSecret },
    });
  }
}
