import {
  ClientInformation,
  PostDetails,
  PostResponse,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { MastodonProvider } from '@gitroom/nestjs-libraries/integrations/social/mastodon.provider';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { Integration } from '@prisma/client';

export class MastodonCustomProvider extends MastodonProvider {
  override identifier = 'mastodon-custom';
  override name = 'Mastodon\n(Custom Instance)';
  toolTip =
    'Connect an account from any Mastodon server, you will be asked for its address';
  override maxConcurrentJob = 5; // Custom Mastodon instances typically have generous limits
  editor = 'normal' as const;

  // Accepts what users type ("mastodon.gamedev.place", a profile link...) and
  // keeps only the origin of the instance. It must be a public https url,
  // unless SSRF protection is disabled for instances on a private network.
  private normalizeInstanceUrl(url: string) {
    const value = (url || '').trim();
    const parsed = new URL(
      /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`
    );
    const isPublicHttps =
      parsed.protocol === 'https:' && parsed.hostname.includes('.');
    const isPrivateAllowed =
      process.env.DISABLE_SSRF_PROTECTION === 'true' &&
      ['https:', 'http:'].includes(parsed.protocol);
    if (!isPublicHttps && !isPrivateAllowed) {
      throw new Error('The instance url must be a public https url');
    }

    return parsed.origin;
  }

  // Registers a Postiz app on the user's instance (every Mastodon server has
  // its own OAuth apps). The returned credentials are stored encrypted on the
  // channel, together with the instance url.
  async externalUrl(url: string) {
    const instanceUrl = this.normalizeInstanceUrl(url);
    const form = new FormData();
    form.append('client_name', 'Postiz');
    form.append('redirect_uris', this.redirectUri());
    form.append('scopes', this.scopes.join(' '));
    form.append('website', process.env.FRONTEND_URL!);
    const { client_id, client_secret } = await (
      await fetch(instanceUrl + '/api/v1/apps', {
        method: 'POST',
        body: form,
        // @ts-ignore - undici-only option; blocks SSRF to internal IPs
        dispatcher: getSsrfSafeDispatcher(),
      })
    )
      .json()
      .catch(() => ({}));

    if (!client_id || !client_secret) {
      throw new Error('Could not register Postiz on this Mastodon instance');
    }

    return {
      client_id,
      client_secret,
      instanceUrl,
    };
  }
  override async generateAuthUrl(external?: ClientInformation) {
    const state = makeSecureId(6);
    const url = this.generateUrlDynamic(
      external?.instanceUrl!,
      state,
      external?.client_id!
    );

    return {
      url,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  override async authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh?: string;
    },
    clientInformation?: ClientInformation
  ) {
    return this.dynamicAuthenticate(
      clientInformation?.client_id!,
      clientInformation?.client_secret!,
      clientInformation?.instanceUrl!,
      params.code
    );
  }

  // The user's instance URL, saved encrypted at connection time. Falls back to
  // the default instance for legacy integrations that predate storing it.
  private instanceUrl(integration?: Integration) {
    try {
      const { instanceUrl } = JSON.parse(
        AuthService.fixedDecryption(integration?.customInstanceDetails || '')
      );
      return instanceUrl || process.env.MASTODON_URL || 'https://mastodon.social';
    } catch (err) {
      return process.env.MASTODON_URL || 'https://mastodon.social';
    }
  }

  override async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    return this.dynamicPost(
      id,
      accessToken,
      this.instanceUrl(integration),
      postDetails
    );
  }

  // checkPostStatus / finalizePost are inherited as-is: the instance url
  // travels inside pendingData, set here once.
  override async postPending(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    return this.dynamicPostPending(
      id,
      accessToken,
      this.instanceUrl(integration),
      postDetails
    );
  }

  override async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    return this.dynamicComment(
      id,
      postId,
      lastCommentId,
      accessToken,
      this.instanceUrl(integration),
      postDetails
    );
  }
}
