import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationInstanceAppService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.instance.app.service';
import { MastodonProvider } from '@gitroom/nestjs-libraries/integrations/social/mastodon.provider';
import { InstanceAppKey } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.instance.app.repository';

// In-memory table with the same unique key as IntegrationInstanceApp
const memoryRepository = () => {
  const rows = new Map<
    string,
    InstanceAppKey & { clientId: string; clientSecret: string }
  >();
  const id = (key: InstanceAppKey) =>
    [key.provider, key.instanceUrl, key.redirectUri].join('|');

  return {
    rows,
    get: vi.fn(async (key: InstanceAppKey) => rows.get(id(key)) || null),
    create: vi.fn(
      async (key: InstanceAppKey, clientId: string, clientSecret: string) => {
        if (!rows.has(id(key))) {
          rows.set(id(key), { ...key, clientId, clientSecret });
        }
        return rows.get(id(key))!;
      }
    ),
    replace: vi.fn(
      async (key: InstanceAppKey, clientId: string, clientSecret: string) => {
        rows.set(id(key), { ...key, clientId, clientSecret });
        return rows.get(id(key))!;
      }
    ),
  };
};

// Stands in for EncryptionService: reversible and visibly not plain text
const fakeEncryption = () => ({
  encrypt: vi.fn(async (value: string) => `enc(${value})`),
  decrypt: vi.fn(async (value: string) => {
    const match = value.match(/^enc\((.*)\)$/);
    if (!match) {
      throw new Error('wrong key');
    }
    return match[1];
  }),
});

describe('IntegrationInstanceAppService', () => {
  let repository: ReturnType<typeof memoryRepository>;
  let encryption: ReturnType<typeof fakeEncryption>;
  let service: IntegrationInstanceAppService;
  let provider: MastodonProvider;
  let register: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('FRONTEND_URL', 'https://postiz.example.com');
    vi.stubEnv('MASTODON_URL', 'https://mastodon.social');
    vi.stubEnv('MASTODON_CLIENT_ID', 'env-client');
    vi.stubEnv('MASTODON_CLIENT_SECRET', 'env-secret');
    repository = memoryRepository();
    encryption = fakeEncryption();
    service = new IntegrationInstanceAppService(
      repository as any,
      encryption as any
    );
    provider = new MastodonProvider();
    let count = 0;
    register = vi.fn(async () => {
      count++;
      return { client_id: `cid-${count}`, client_secret: `secret-${count}` };
    });
    provider.externalUrl = register as any;
  });

  it('registers an app the first time an instance connects and stores it encrypted', async () => {
    const info = await service.getClientInformation(
      provider,
      'mastodon.gamedev.place/'
    );

    expect(register).toHaveBeenCalledWith('https://mastodon.gamedev.place');
    expect(info).toEqual({
      instanceUrl: 'https://mastodon.gamedev.place',
      client_id: 'cid-1',
      client_secret: 'secret-1',
    });
    expect([...repository.rows.values()]).toEqual([
      {
        provider: 'mastodon',
        instanceUrl: 'https://mastodon.gamedev.place',
        redirectUri: 'https://postiz.example.com/integrations/social/mastodon',
        clientId: 'enc(cid-1)',
        clientSecret: 'enc(secret-1)',
      },
    ]);
  });

  it('reuses the stored app for the next channels of the same instance', async () => {
    await service.getClientInformation(provider, 'mastodon.gamedev.place');
    const again = await service.getClientInformation(
      provider,
      'https://Mastodon.GameDev.place/@other'
    );

    expect(register).toHaveBeenCalledTimes(1);
    expect(again?.client_id).toBe('cid-1');
  });

  it('registers one app per instance', async () => {
    await service.getClientInformation(provider, 'mastodon.gamedev.place');
    const other = await service.getClientInformation(provider, 'fosstodon.org');

    expect(register).toHaveBeenCalledTimes(2);
    expect(other).toMatchObject({
      instanceUrl: 'https://fosstodon.org',
      client_id: 'cid-2',
    });
    expect(repository.rows.size).toBe(2);
  });

  it('registers again when the callback url changed', async () => {
    await service.getClientInformation(provider, 'mastodon.gamedev.place');
    vi.stubEnv('FRONTEND_URL', 'https://postiz.new-domain.example.com');
    await service.getClientInformation(provider, 'mastodon.gamedev.place');

    expect(register).toHaveBeenCalledTimes(2);
  });

  it('keeps the app stored first when two connections race', async () => {
    repository.get.mockResolvedValueOnce(null);
    repository.rows.set(
      'mastodon|https://mastodon.gamedev.place|https://postiz.example.com/integrations/social/mastodon',
      {
        provider: 'mastodon',
        instanceUrl: 'https://mastodon.gamedev.place',
        redirectUri: 'https://postiz.example.com/integrations/social/mastodon',
        clientId: 'enc(first)',
        clientSecret: 'enc(first-secret)',
      }
    );

    const info = await service.getClientInformation(
      provider,
      'mastodon.gamedev.place'
    );

    expect(info?.client_id).toBe('first');
  });

  it('replaces an app that can no longer be decrypted', async () => {
    await service.getClientInformation(provider, 'mastodon.gamedev.place');
    const [row] = repository.rows.values();
    row.clientSecret = 'encrypted-with-an-old-key';

    const info = await service.getClientInformation(
      provider,
      'mastodon.gamedev.place'
    );

    expect(info?.client_id).toBe('cid-2');
    expect(repository.replace).toHaveBeenCalledTimes(1);
  });

  it('uses the env app (no registration) for an empty field or MASTODON_URL', async () => {
    expect(await service.getClientInformation(provider)).toBeUndefined();
    expect(await service.getClientInformation(provider, '')).toBeUndefined();
    expect(
      await service.getClientInformation(provider, 'mastodon.social')
    ).toBeUndefined();
    expect(register).not.toHaveBeenCalled();
  });

  it('registers on MASTODON_URL when the env has no app', async () => {
    vi.stubEnv('MASTODON_CLIENT_ID', '');
    const info = await service.getClientInformation(provider);

    expect(info).toMatchObject({
      instanceUrl: 'https://mastodon.social',
      client_id: 'cid-1',
    });
  });

  it('rejects an invalid instance before calling it', async () => {
    await expect(
      service.getClientInformation(provider, 'ftp://mastodon.gamedev.place')
    ).rejects.toThrow();
    expect(register).not.toHaveBeenCalled();
  });

  it('does nothing for providers without instances', async () => {
    expect(
      await service.getClientInformation({ identifier: 'x' } as any, 'a.b')
    ).toBeUndefined();
  });
});
