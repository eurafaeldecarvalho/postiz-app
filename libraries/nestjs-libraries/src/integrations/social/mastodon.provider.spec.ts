import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MastodonProvider,
  normalizeMastodonInstanceUrl,
} from '@gitroom/nestjs-libraries/integrations/social/mastodon.provider';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { Integration } from '@prisma/client';

const jsonResponse = (body: any, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const gamedev = {
  client_id: 'gamedev-client',
  client_secret: 'gamedev-secret',
  instanceUrl: 'https://mastodon.gamedev.place',
};

// a channel as it is stored: only the instance url, encrypted
const channelOn = (instanceUrl: string) =>
  ({
    customInstanceDetails: AuthService.fixedEncryption(
      JSON.stringify({ instanceUrl })
    ),
  } as Integration);

describe('MastodonProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('FRONTEND_URL', 'https://postiz.example.com');
    vi.stubEnv('JWT_SECRET', 'test-secret');
    vi.stubEnv('MASTODON_URL', 'https://mastodon.social');
    vi.stubEnv('MASTODON_CLIENT_ID', 'env-client');
    vi.stubEnv('MASTODON_CLIENT_SECRET', 'env-secret');
    vi.stubEnv('DISABLE_SSRF_PROTECTION', '');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('normalizeMastodonInstanceUrl', () => {
    it.each([
      ['mastodon.gamedev.place', 'https://mastodon.gamedev.place'],
      ['https://mastodon.gamedev.place/', 'https://mastodon.gamedev.place'],
      ['https://mastodon.gamedev.place///', 'https://mastodon.gamedev.place'],
      ['  Mastodon.GameDev.Place  ', 'https://mastodon.gamedev.place'],
      [
        'https://mastodon.gamedev.place/@someone',
        'https://mastodon.gamedev.place',
      ],
      ['http://mastodon.gamedev.place', 'https://mastodon.gamedev.place'],
      ['https://social.example.org:8443/', 'https://social.example.org:8443'],
    ])('normalizes "%s" to "%s"', (input, expected) => {
      expect(normalizeMastodonInstanceUrl(input)).toBe(expected);
    });

    it.each([
      [''],
      ['   '],
      ['not a url'],
      ['localhost'],
      ['ftp://mastodon.gamedev.place'],
      ['https://user:pass@mastodon.gamedev.place'],
    ])('rejects "%s"', (input) => {
      expect(() => normalizeMastodonInstanceUrl(input)).toThrow();
    });

    it('keeps http and private hosts when SSRF protection is disabled', () => {
      vi.stubEnv('DISABLE_SSRF_PROTECTION', 'true');
      expect(normalizeMastodonInstanceUrl('http://mastodon:3000/')).toBe(
        'http://mastodon:3000'
      );
    });
  });

  describe('resolveExternalUrl', () => {
    it('falls back to MASTODON_URL and its env app when the field is empty', () => {
      const provider = new MastodonProvider();
      for (const empty of [undefined, '', '   ']) {
        expect(provider.resolveExternalUrl(empty)).toEqual({
          instanceUrl: 'https://mastodon.social',
          defaultApp: true,
        });
      }
    });

    it('uses mastodon.social when MASTODON_URL is not set', () => {
      vi.stubEnv('MASTODON_URL', '');
      expect(new MastodonProvider().resolveExternalUrl()).toEqual({
        instanceUrl: 'https://mastodon.social',
        defaultApp: true,
      });
    });

    it('ignores a trailing slash in MASTODON_URL', () => {
      vi.stubEnv('MASTODON_URL', 'https://mastodon.example.org/');
      expect(
        new MastodonProvider().resolveExternalUrl('mastodon.example.org')
      ).toEqual({
        instanceUrl: 'https://mastodon.example.org',
        defaultApp: true,
      });
    });

    it('uses the env app when the typed instance is MASTODON_URL', () => {
      expect(
        new MastodonProvider().resolveExternalUrl('https://Mastodon.social/')
      ).toEqual({ instanceUrl: 'https://mastodon.social', defaultApp: true });
    });

    it('needs an app of its own for any other instance', () => {
      expect(
        new MastodonProvider().resolveExternalUrl('mastodon.gamedev.place')
      ).toEqual({
        instanceUrl: 'https://mastodon.gamedev.place',
        defaultApp: false,
      });
    });

    it('registers an app on the default instance too when the env has none', () => {
      vi.stubEnv('MASTODON_CLIENT_ID', '');
      vi.stubEnv('MASTODON_CLIENT_SECRET', '');
      expect(new MastodonProvider().resolveExternalUrl()).toEqual({
        instanceUrl: 'https://mastodon.social',
        defaultApp: false,
      });
    });
  });

  describe('externalUrl (app registration)', () => {
    it('registers Postiz on the instance with the current callback and scopes', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ client_id: 'cid', client_secret: 'csecret' })
      );

      const app = await new MastodonProvider().externalUrl(
        'https://mastodon.gamedev.place'
      );

      expect(app).toEqual({ client_id: 'cid', client_secret: 'csecret' });
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://mastodon.gamedev.place/api/v1/apps');
      expect(options.method).toBe('POST');
      expect(options.body.get('client_name')).toBe('Postiz');
      expect(options.body.get('redirect_uris')).toBe(
        'https://postiz.example.com/integrations/social/mastodon'
      );
      expect(options.body.get('scopes')).toBe(
        'write:statuses profile write:media'
      );
      expect(options.body.get('website')).toBe('https://postiz.example.com');
    });

    it('fails clearly when the instance does not answer with an app', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('<html>Bad gateway</html>', { status: 502 })
      );
      await expect(
        new MastodonProvider().externalUrl('https://mastodon.gamedev.place')
      ).rejects.toThrow('Could not register Postiz on this Mastodon instance');

      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: 'Validation failed' }, 422)
      );
      await expect(
        new MastodonProvider().externalUrl('https://mastodon.gamedev.place')
      ).rejects.toThrow();
    });
  });

  describe('generateAuthUrl', () => {
    it('keeps the default instance and env app without client information', async () => {
      const { url, state } = await new MastodonProvider().generateAuthUrl();

      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe(
        'https://mastodon.social/oauth/authorize'
      );
      expect(parsed.searchParams.get('client_id')).toBe('env-client');
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('scope')).toBe(
        'write:statuses profile write:media'
      );
      expect(parsed.searchParams.get('state')).toBe(state);
      expect(parsed.searchParams.get('redirect_uri')).toBe(
        'https://postiz.example.com/integrations/social/mastodon'
      );
    });

    it('sends the user to the authorize page of the chosen instance', async () => {
      const { url } = await new MastodonProvider().generateAuthUrl(gamedev);

      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe(
        'https://mastodon.gamedev.place/oauth/authorize'
      );
      expect(parsed.searchParams.get('client_id')).toBe('gamedev-client');
      expect(parsed.searchParams.get('redirect_uri')).toBe(
        'https://postiz.example.com/integrations/social/mastodon'
      );
    });
  });

  describe('authenticate', () => {
    const tokenAndProfile = () =>
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ access_token: 'token' }))
        .mockResolvedValueOnce(
          jsonResponse({ id: '42', username: 'someone', display_name: 'S' })
        );

    it('exchanges the code on the chosen instance with its app', async () => {
      tokenAndProfile();

      const auth = await new MastodonProvider().authenticate(
        { code: 'the-code', codeVerifier: '' },
        gamedev
      );

      const [tokenUrl, tokenOptions] = fetchMock.mock.calls[0];
      expect(tokenUrl).toBe('https://mastodon.gamedev.place/oauth/token');
      expect(tokenOptions.body.get('client_id')).toBe('gamedev-client');
      expect(tokenOptions.body.get('client_secret')).toBe('gamedev-secret');
      expect(tokenOptions.body.get('code')).toBe('the-code');
      expect(tokenOptions.body.get('redirect_uri')).toBe(
        'https://postiz.example.com/integrations/social/mastodon'
      );
      expect(fetchMock.mock.calls[1][0]).toBe(
        'https://mastodon.gamedev.place/api/v1/accounts/verify_credentials'
      );
      expect(auth).toMatchObject({ id: '42', accessToken: 'token' });
    });

    it('keeps exchanging on MASTODON_URL with the env app by default', async () => {
      tokenAndProfile();

      await new MastodonProvider().authenticate({
        code: 'the-code',
        codeVerifier: '',
      });

      const [tokenUrl, tokenOptions] = fetchMock.mock.calls[0];
      expect(tokenUrl).toBe('https://mastodon.social/oauth/token');
      expect(tokenOptions.body.get('client_id')).toBe('env-client');
      expect(tokenOptions.body.get('client_secret')).toBe('env-secret');
    });
  });

  describe('publishing', () => {
    const post = (media: any[] = []) => [
      { id: 'post', message: 'hello', settings: {}, media } as any,
    ];

    it('uploads media and publishes on the instance of the channel', async () => {
      fetchMock
        // the media file, read from storage
        .mockResolvedValueOnce(
          new Response('image-bytes', {
            headers: { 'content-length': '11' },
          })
        )
        // the upload to the instance
        .mockResolvedValueOnce(jsonResponse({ id: 'media-1' }));

      const provider = new MastodonProvider();
      const [pending] = await provider.postPending(
        'id',
        'token',
        post([{ path: 'https://uploads.example.com/image.png' }]),
        channelOn('https://mastodon.gamedev.place')
      );

      expect(fetchMock.mock.calls[1][0]).toBe(
        'https://mastodon.gamedev.place/api/v1/media'
      );
      expect(pending.pendingData).toMatchObject({
        url: 'https://mastodon.gamedev.place',
        mediaIds: ['media-1'],
      });

      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'status-1' }));
      const done = await provider.finalizePost(
        'token',
        pending.pendingData,
        {} as Integration
      );

      expect(fetchMock.mock.calls[2][0]).toBe(
        'https://mastodon.gamedev.place/api/v1/statuses'
      );
      expect(done).toMatchObject({
        status: 'completed',
        postId: 'status-1',
        releaseURL: 'https://mastodon.gamedev.place/statuses/status-1',
      });
    });

    it('keeps publishing channels without a stored instance on MASTODON_URL', async () => {
      const provider = new MastodonProvider();
      for (const integration of [
        { customInstanceDetails: null } as Integration,
        { customInstanceDetails: 'not-encrypted' } as Integration,
      ]) {
        const [pending] = await provider.postPending(
          'id',
          'token',
          post(),
          integration
        );
        expect(pending.pendingData.url).toBe('https://mastodon.social');
      }
    });

    it('answers comments on the instance of the channel', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'reply-1' }));

      const [reply] = await new MastodonProvider().comment(
        'id',
        'status-1',
        undefined,
        'token',
        post(),
        channelOn('https://mastodon.gamedev.place')
      );

      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://mastodon.gamedev.place/api/v1/statuses'
      );
      expect(reply.releaseURL).toBe(
        'https://mastodon.gamedev.place/statuses/reply-1'
      );
    });
  });
});

describe('IntegrationManager', () => {
  it('shows Mastodon with an optional instance and keeps it in invite links', async () => {
    const manager = new IntegrationManager();
    const { social } = await manager.getAllIntegrations();
    expect(social.find((p) => p.identifier === 'mastodon')).toMatchObject({
      isExternal: true,
      isExternalOptional: true,
    });
    expect(manager.getLinkableSocialsIntegrations()).toContain('mastodon');
  });
});
