import type {
  AgentSettingsView,
  AgentSettingsUpdate,
  AgentConnectionTest,
  AppleMatchResult,
  ArtistAliasCatalogStatus,
  AuthStatus,
  MatchJob,
  MatchPreferences,
  MatchRetryScope,
  MusicProvider,
  NormalizedPlaylist,
  NormalizedTrack,
  PortablePlaylistFile,
  TaskSummary,
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
  getAgentSettings: () => request<AgentSettingsView>("/api/agent/settings"),
  putAgentSettings: (settings: AgentSettingsUpdate) => request<AgentSettingsView>("/api/agent/settings", { method: "PUT", body: JSON.stringify(settings) }),
  testAgentSettings: (settings: AgentSettingsUpdate) => request<AgentConnectionTest>("/api/agent/settings/test", { method: "POST", body: JSON.stringify(settings) }),
  startAgent: (id: string, indices: number[]) => request<{ runId: string; total: number }>(`/api/match-apple/${encodeURIComponent(id)}/agent`, { method: "POST", body: JSON.stringify({ indices }) }),
  cancelAgent: (id: string, runId: string) => request<{ cancelled: boolean }>(`/api/match-apple/${encodeURIComponent(id)}/agent/cancel`, { method: "POST", body: JSON.stringify({ runId }) }),
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

  async importPlaylist(
    file: PortablePlaylistFile,
  ): Promise<{ key: string; playlist: NormalizedPlaylist }> {
    return request<{ key: string; playlist: NormalizedPlaylist }>(
      "/api/playlists/import",
      { method: "POST", body: JSON.stringify(file) },
    );
  },

  async listPlaylists(): Promise<TaskSummary[]> {
    return request<TaskSummary[]>("/api/playlists");
  },

  async listTasks(): Promise<TaskSummary[]> {
    return request<TaskSummary[]>("/api/tasks");
  },

  async deleteTasks(keys: string[]): Promise<{ removed: number }> {
    return request<{ removed: number }>("/api/tasks", {
      method: "DELETE",
      body: JSON.stringify({ keys }),
    });
  },

  async clearCompletedTasks(): Promise<{ removed: number; keys: string[] }> {
    return request<{ removed: number; keys: string[] }>(
      "/api/tasks/clear-completed",
      { method: "POST" },
    );
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

  async runMatch(playlistId: string): Promise<{ status: string }> {
    return request<{ status: string }>("/api/match-apple", {
      method: "POST",
      body: JSON.stringify({ playlistId }),
    });
  },

  async retryNotFound(playlistId: string): Promise<{ status: string; retried?: number }> {
    return request<{ status: string; retried?: number }>(
      `/api/match-apple/${encodeURIComponent(playlistId)}/retry-not-found`,
      { method: "POST" },
    );
  },

  async retryMatch(
    playlistId: string,
    scope: MatchRetryScope,
    indices: number[] = [],
  ): Promise<{ status: string; retried?: number }> {
    return request<{ status: string; retried?: number }>(
      `/api/match-apple/${encodeURIComponent(playlistId)}/retry`,
      {
        method: "POST",
        body: JSON.stringify({ scope, indices }),
      },
    );
  },

  async getMatchJob(playlistId: string): Promise<MatchJob> {
    return request<MatchJob>(
      `/api/match-apple/${encodeURIComponent(playlistId)}`,
    );
  },

  async selectTrack(
    playlistId: string,
    idx: number,
    appleMusicId: string | null,
  ): Promise<AppleMatchResult> {
    return request<AppleMatchResult>(
      `/api/match-apple/${encodeURIComponent(playlistId)}/tracks/${idx}`,
      {
        method: "PUT",
        body: JSON.stringify({ appleMusicId }),
      },
    );
  },

  async getPreferences(): Promise<MatchPreferences> {
    return request<MatchPreferences>("/api/preferences");
  },

  async putPreferences(prefs: MatchPreferences): Promise<MatchPreferences> {
    return request<MatchPreferences>("/api/preferences", {
      method: "PUT",
      body: JSON.stringify(prefs),
    });
  },

  async getArtistAliasCatalog(): Promise<ArtistAliasCatalogStatus> {
    return request<ArtistAliasCatalogStatus>("/api/artist-alias-catalog");
  },

  async downloadArtistAliasCatalog(): Promise<ArtistAliasCatalogStatus> {
    return request<ArtistAliasCatalogStatus>("/api/artist-alias-catalog/download", {
      method: "POST",
    });
  },

  async cancelArtistAliasCatalogDownload(): Promise<ArtistAliasCatalogStatus> {
    return request<ArtistAliasCatalogStatus>("/api/artist-alias-catalog/cancel", {
      method: "POST",
    });
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
