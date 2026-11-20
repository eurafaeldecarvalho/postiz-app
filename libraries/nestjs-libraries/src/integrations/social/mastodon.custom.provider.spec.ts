import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MastodonCustomProvider } from '@gitroom/nestjs-libraries/integrations/social/mastodon.custom.provider';
import { MastodonProvider } from '@gitroom/nestjs-libraries/integrations/social/mastodon.provider';
import { socialIntegrationList } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { Integration } from '@prisma/client';
import { allProviders } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/all.providers.settings';

const jsonResponse = (body: any, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('MastodonCustomProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://postiz.example.com';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('externalUrl', () => {
    it('registers an app on the instance with the mastodon-custom callback', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ client_id: 'cid', client_secret: 'csecret' })
      );

      const result = await new MastodonCustomProvider().externalUrl(
        'https://mastodon.gamedev.place'
      );

      expect(result).toEqual({
        client_id: 'cid',
        client_secret: 'csecret',
        instanceUrl: 'https://mastodon.gamedev.place',
      });
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://mastodon.gamedev.place/api/v1/apps');
      expect(options.method).toBe('POST');
      expect(options.body.get('redirect_uris')).toBe(
        'https://postiz.example.com/integrations/social/mastodon-custom'
      );
      expect(options.body.get('scopes')).toBe(
        'write:statuses profile write:media'
      );
    });

    it.each([
      ['mastodon.gamedev.place'],
      ['https://mastodon.gamedev.place/'],
      ['  https://Mastodon.GameDev.place/@someone  '],
    ])('normalizes "%s" to the instance origin', async (input) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ client_id: 'cid', client_secret: 'csecret' })
      );

      const result = await new MastodonCustomProvider().externalUrl(input);

      expect(result.instanceUrl).toBe('https://mastodon.gamedev.place');
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://mastodon.gamedev.place/api/v1/apps'
      );
    });

    it.each([['http://mastodon.gamedev.place'], ['not a url'], ['']])(
      'rejects "%s" without calling the network',
      async (input) => {
        await expect(
          new MastodonCustomProvider().externalUrl(input)
        ).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
      }
    );

    it('fails when the instance does not return app credentials', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: 'Validation failed' }, 422)
      );

      await expect(
        new MastodonCustomProvider().externalUrl(
          'https://mastodon.gamedev.place'
        )
      ).rejects.toThrow();
    });
  });

  const client = {
    client_id: 'cid',
    client_secret: 'csecret',
    instanceUrl: 'https://mastodon.gamedev.place',
  };

  describe('generateAuthUrl', () => {
    it('sends the user to the authorize page of their own instance', async () => {
      const { url, state } = await new MastodonCustomProvider().generateAuthUrl(
        client
      );

      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe(
        'https://mastodon.gamedev.place/oauth/authorize'
      );
      expect(parsed.searchParams.get('client_id')).toBe('cid');
      expect(parsed.searchParams.get('state')).toBe(state);
      expect(parsed.searchParams.get('redirect_uri')).toBe(
        'https://postiz.example.com/integrations/social/mastodon-custom'
      );
    });
  });

  describe('authenticate', () => {
    it('exchanges the code on the instance of the channel', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ access_token: 'token' }))
        .mockResolvedValueOnce(
          jsonResponse({
            id: '42',
            username: 'someone',
            display_name: 'Someone',
            avatar: 'https://mastodon.gamedev.place/avatar.png',
          })
        );

      const auth = await new MastodonCustomProvider().authenticate(
        { code: 'the-code', codeVerifier: '' },
        client
      );

      const [tokenUrl, tokenOptions] = fetchMock.mock.calls[0];
      expect(tokenUrl).toBe('https://mastodon.gamedev.place/oauth/token');
      expect(tokenOptions.body.get('client_id')).toBe('cid');
      expect(tokenOptions.body.get('client_secret')).toBe('csecret');
      expect(tokenOptions.body.get('redirect_uri')).toBe(
        'https://postiz.example.com/integrations/social/mastodon-custom'
      );
      expect(fetchMock.mock.calls[1][0]).toBe(
        'https://mastodon.gamedev.place/api/v1/accounts/verify_credentials'
      );
      expect(auth).toMatchObject({
        id: '42',
        accessToken: 'token',
        username: 'someone',
      });
    });
  });

  describe('postPending', () => {
    it('publishes to the instance stored on the channel', async () => {
      process.env.JWT_SECRET = 'test-secret';
      const integration = {
        customInstanceDetails: AuthService.fixedEncryption(
          JSON.stringify(client)
        ),
      } as Integration;

      const [response] = await new MastodonCustomProvider().postPending(
        'id',
        'token',
        [{ id: 'post', message: 'hello', settings: {}, media: [] } as any],
        integration
      );

      expect(response.pendingData.url).toBe('https://mastodon.gamedev.place');
    });
  });
});

describe('MastodonProvider (default instance)', () => {
  it('keeps using MASTODON_URL and the mastodon callback', async () => {
    process.env.FRONTEND_URL = 'https://postiz.example.com';
    process.env.MASTODON_URL = 'https://mastodon.social';
    process.env.MASTODON_CLIENT_ID = 'env-client';

    const { url } = await new MastodonProvider().generateAuthUrl();

    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://mastodon.social');
    expect(parsed.searchParams.get('client_id')).toBe('env-client');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://postiz.example.com/integrations/social/mastodon'
    );
  });
});

describe('socialIntegrationList', () => {
  it('offers both the default and the custom instance Mastodon providers', () => {
    const identifiers = socialIntegrationList.map((p) => p.identifier);
    expect(identifiers).toContain('mastodon');
    expect(identifiers).toContain('mastodon-custom');
  });
});

describe('post settings', () => {
  it('accepts posts for custom instance channels like the default Mastodon', () => {
    const names = allProviders(class {}).map((p) => p.name);
    expect(names).toContain('mastodon');
    expect(names).toContain('mastodon-custom');
  });
});
