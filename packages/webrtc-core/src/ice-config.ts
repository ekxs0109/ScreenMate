export type TurnOAuthCredential = {
  accessToken: string;
  macKey: string;
};

export type IceCredential = string | TurnOAuthCredential;

export type IceCredentialType = "password" | "oauth";

export type IceServerInput = {
  urls: string | string[];
  username?: string;
  credential?: IceCredential;
  credentialType?: IceCredentialType;
};

export type NormalizedIceServer = {
  urls: string[];
  username?: string;
  credential?: IceCredential;
  credentialType?: IceCredentialType;
};

const ICE_URL_SCHEMES = new Set(["stun:", "stuns:", "turn:", "turns:"]);

function normalizeUrls(urls: IceServerInput["urls"]): string[] {
  const inputUrls = Array.isArray(urls) ? urls : [urls];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const url of inputUrls) {
    const candidate = url.trim();
    if (!candidate) continue;

    const scheme = candidate.slice(0, candidate.indexOf(":") + 1).toLowerCase();
    if (!ICE_URL_SCHEMES.has(scheme) || seen.has(candidate)) continue;

    seen.add(candidate);
    normalized.push(candidate);
  }

  return normalized;
}

function normalizeCredential(
  credential: IceCredential | undefined,
): IceCredential | undefined {
  if (typeof credential === "string") {
    return credential;
  }

  if (!credential) {
    return undefined;
  }

  return {
    accessToken: credential.accessToken,
    macKey: credential.macKey,
  };
}

export function normalizeIceServers(
  servers: IceServerInput[],
): NormalizedIceServer[] {
  const seen = new Set<string>();
  const normalized: NormalizedIceServer[] = [];

  for (const server of servers) {
    const urls = normalizeUrls(server.urls);
    if (urls.length === 0) continue;

    const candidate: NormalizedIceServer = { urls };

    if (server.username !== undefined) {
      candidate.username = server.username;
    }

    if (server.credential !== undefined) {
      candidate.credential = normalizeCredential(server.credential);
    }

    if (server.credentialType !== undefined) {
      candidate.credentialType = server.credentialType;
    }

    const key = JSON.stringify({
      urls: candidate.urls,
      username: candidate.username ?? null,
      credentialType: candidate.credentialType ?? null,
      credential:
        typeof candidate.credential === "string"
          ? candidate.credential
          : candidate.credential
            ? {
                accessToken: candidate.credential.accessToken,
                macKey: candidate.credential.macKey,
              }
            : null,
    });

    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push(candidate);
  }

  return normalized;
}
