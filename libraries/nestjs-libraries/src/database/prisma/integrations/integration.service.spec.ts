import { describe, expect, it } from 'vitest';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

const serviceWith = (integration: any) =>
  new IntegrationService(
    { getIntegrationByInternalId: async () => integration } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

describe('IntegrationService.getConnectedInstanceUrl', () => {
  it('returns the instance a channel of an external provider was connected to', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const service = serviceWith({
      customInstanceDetails: AuthService.fixedEncryption(
        JSON.stringify({
          client_id: 'cid',
          client_secret: 'csecret',
          instanceUrl: 'https://mastodon.gamedev.place',
        })
      ),
    });

    expect(await service.getConnectedInstanceUrl('org', 'internal')).toBe(
      'https://mastodon.gamedev.place'
    );
  });

  it('returns nothing for a channel without stored instance details', async () => {
    expect(
      await serviceWith({
        customInstanceDetails: null,
      }).getConnectedInstanceUrl('org', 'internal')
    ).toBeUndefined();
    expect(
      await serviceWith(null).getConnectedInstanceUrl('org', 'internal')
    ).toBeUndefined();
  });
});
