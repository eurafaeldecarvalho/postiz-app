import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the instance a channel was connected to, for its reconnect', async () => {
    vi.stubEnv('JWT_SECRET', 'test-secret');
    const service = serviceWith({
      customInstanceDetails: AuthService.fixedEncryption(
        JSON.stringify({ instanceUrl: 'https://mastodon.gamedev.place' })
      ),
    });

    expect(await service.getConnectedInstanceUrl('org', 'internal')).toBe(
      'https://mastodon.gamedev.place'
    );
  });

  it('returns nothing for channels connected before the instance was stored', async () => {
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
