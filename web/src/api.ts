import type {
  AppleMatchReport,
  AuthStatus,
  MusicProvider,
  NormalizedPlaylist,
  NormalizedTrack,
} from "./types";

async function request<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    throw new Error(
      `Request failed (${res.status} ${res.statusText}) ${detail}`.trim(),
    );
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  async getAuthStatus(): Promise<AuthStatus> {
    return request<AuthStatus>("/api/auth/status");
  },

  async login(provider: MusicProvider): Promise<AuthStatus> {
    return request<AuthStatus>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ provider }),
    });
  },

  async logout(provider: MusicProvider): Promise<AuthStatus> {
    return request<AuthStatus>("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({ provider }),
    });
  },

  async normalize(
    url: string,
    provider?: MusicProvider,
  ): Promise<{ key: string; playlist: NormalizedPlaylist }> {
    return request<{ key: string; playlist: NormalizedPlaylist }>("/api/normalize", {
      method: "POST",
      body: JSON.stringify({ url, provider }),
    });
  },

  async listPlaylists(): Promise<{ key: string; playlist: NormalizedPlaylist }[]> {
    return request<{ key: string; playlist: NormalizedPlaylist }[]>("/api/playlists");
  },

  async getPlaylist(id: string): Promise<NormalizedPlaylist> {
    return request<NormalizedPlaylist>(
      `/api/playlists/${encodeURIComponent(id)}`,
    );
  },

  async updateTrack(
    playlistId: string,
    idx: number,
    patch: Partial<NormalizedTrack>,
  ): Promise<NormalizedTrack> {
    return request<NormalizedTrack>(
      `/api/playlists/${encodeURIComponent(playlistId)}/tracks/${idx}`,
      {
        method: "PUT",
        body: JSON.stringify(patch),
      },
    );
  },

  async deleteTracks(
    playlistId: string,
    indices: number[],
  ): Promise<NormalizedPlaylist> {
    return request<NormalizedPlaylist>(
      `/api/playlists/${encodeURIComponent(playlistId)}/tracks`,
      {
        method: "DELETE",
        body: JSON.stringify({ indices }),
      },
    );
  },

  async runMatch(playlistId: string): Promise<AppleMatchReport> {
    return request<AppleMatchReport>("/api/match-apple", {
      method: "POST",
      body: JSON.stringify({ playlistId }),
    });
  },

  async getMatch(playlistId: string): Promise<AppleMatchReport> {
    return request<AppleMatchReport>(
      `/api/match-apple/${encodeURIComponent(playlistId)}`,
    );
  },

  async createApplePlaylist(playlistId: string, name?: string, description?: string): Promise<{ playlistId: string }> {
    return request<{ playlistId: string }>("/api/apple/create-playlist", {
      method: "POST",
      body: JSON.stringify({ playlistId, name, description }),
    });
  },
};

export function detectProvider(url: string): MusicProvider | null {
  const lower = url.toLowerCase();
  if (
    lower.includes("y.qq.com") ||
    lower.includes("qq.com/n/ryqq") ||
    lower.includes("c.y.qq.com")
  ) {
    return "qq";
  }
  if (lower.includes("music.163.com") || lower.includes("163cn.tv")) {
    return "netease";
  }
  return null;
}
