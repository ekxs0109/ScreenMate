export type IceServerInput = {
  urls: string[];
  username?: string;
  credential?: string;
};

export function normalizeIceServers(servers: IceServerInput[]): RTCIceServer[] {
  const seen = new Set<string>();

  return servers.filter((server) => {
    const key = JSON.stringify(server);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
