import { Injectable } from '@nestjs/common';
import { IntegrationInstanceAppRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.instance.app.repository';
import { EncryptionService } from '@gitroom/nestjs-libraries/services/encryption.service';
import {
  ClientInformation,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

// The OAuth apps of the providers that run on many instances (Mastodon): every
// server has its own apps, so Postiz registers one the first time a channel of
// that instance connects and reuses it for the next channels.
@Injectable()
export class IntegrationInstanceAppService {
  constructor(
    private _repository: IntegrationInstanceAppRepository,
    private _encryptionService: EncryptionService
  ) {}

  // The app to connect a channel on the instance the user typed. Undefined
  // means the provider connects with the app configured in the environment
  // (no instance typed, or the default instance of the provider).
  async getClientInformation(
    provider: SocialProvider,
    url?: string
  ): Promise<ClientInformation | undefined> {
    if (!provider.externalUrl) {
      return undefined;
    }

    const { instanceUrl, defaultApp } = provider.resolveExternalUrl
      ? provider.resolveExternalUrl(url)
      : { instanceUrl: url || '', defaultApp: false };

    if (defaultApp) {
      return undefined;
    }

    if (!instanceUrl) {
      throw new Error('Missing external url');
    }

    const key = {
      provider: provider.identifier,
      instanceUrl,
      redirectUri: provider.externalRedirectUri?.() || '',
    };

    const stored = await this._repository.get(key);
    if (stored) {
      try {
        return {
          instanceUrl,
          client_id: await this._encryptionService.decrypt(stored.clientId),
          client_secret: await this._encryptionService.decrypt(
            stored.clientSecret
          ),
        };
      } catch (err) {
        // Encrypted with a key that is gone: the app can't be used anymore,
        // register a new one in its place
        const app = await this.register(provider, instanceUrl);
        await this._repository.replace(
          key,
          await this._encryptionService.encrypt(app.client_id),
          await this._encryptionService.encrypt(app.client_secret)
        );
        return { instanceUrl, ...app };
      }
    }

    const app = await this.register(provider, instanceUrl);
    const saved = await this._repository.create(
      key,
      await this._encryptionService.encrypt(app.client_id),
      await this._encryptionService.encrypt(app.client_secret)
    );

    return {
      instanceUrl,
      client_id: await this._encryptionService.decrypt(saved.clientId),
      client_secret: await this._encryptionService.decrypt(saved.clientSecret),
    };
  }

  private async register(provider: SocialProvider, instanceUrl: string) {
    const { client_id, client_secret } = await provider.externalUrl!(
      instanceUrl
    );
    if (!client_id || !client_secret) {
      throw new Error('The instance did not return the app credentials');
    }

    return { client_id, client_secret };
  }
}
