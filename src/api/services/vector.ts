import type { VectorSearchResult } from "../types";

export class VectorService {
  private url: string;
  private token: string;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  private async request(endpoint: string, body: any): Promise<any> {
    const response = await fetch(`${this.url}/${endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return response.json();
  }

  /**
   * Store an insight with auto-embedding via BGE-M3
   */
  async storeInsight(
    id: string,
    content: string,
    userId: string,
    topics: string[]
  ): Promise<void> {
    try {
      const result = await this.request("upsert-data", [{
        id,
        data: content, // BGE-M3 will auto-embed this
        metadata: {
          userId,
          content,
          topics: topics.join(","),
          createdAt: Date.now(),
        },
      }]);
      
      if (result.error) {
        console.error("Vector upsert error:", result.error);
      }
    } catch (error) {
      console.error("Vector store error:", error);
    }
  }

  /**
   * Semantic search using BGE-M3 embeddings
   */
  async searchSimilar(
    query: string,
    userId?: string,
    topK: number = 5
  ): Promise<VectorSearchResult[]> {
    try {
      const body: any = {
        data: query, // BGE-M3 will auto-embed this
        topK,
        includeMetadata: true,
      };

      // Add filter if userId provided
      if (userId) {
        body.filter = `userId = '${userId}'`;
      }

      const result = await this.request("query-data", body);

      if (result.error) {
        console.error("Vector search error:", result.error);
        return [];
      }

      return (result.result || []).map((hit: any) => ({
        id: hit.id,
        content: hit.metadata?.content || "",
        topics: (hit.metadata?.topics || "").split(",").filter(Boolean),
        score: hit.score,
      }));
    } catch (error) {
      console.error("Vector search error:", error);
      return [];
    }
  }

  /**
   * Search global insights (no user filter)
   */
  async searchGlobal(query: string, topK: number = 5): Promise<VectorSearchResult[]> {
    return this.searchSimilar(query, undefined, topK);
  }

  /**
   * Delete an insight from vector store
   */
  async deleteInsight(id: string): Promise<void> {
    try {
      await this.request("delete", { ids: [id] });
    } catch (error) {
      console.error("Vector delete error:", error);
    }
  }

  /**
   * Batch upsert multiple insights
   */
  async batchStore(
    items: Array<{ id: string; content: string; userId: string; topics: string[] }>
  ): Promise<void> {
    try {
      const vectors = items.map((item) => ({
        id: item.id,
        data: item.content,
        metadata: {
          userId: item.userId,
          content: item.content,
          topics: item.topics.join(","),
          createdAt: Date.now(),
        },
      }));

      await this.request("upsert-data", vectors);
    } catch (error) {
      console.error("Vector batch store error:", error);
    }
  }

  /**
   * Get index info
   */
  async getInfo(): Promise<any> {
    try {
      const response = await fetch(`${this.url}/info`, {
        headers: { "Authorization": `Bearer ${this.token}` },
      });
      return response.json();
    } catch {
      return null;
    }
  }
}

// Factory function
export const createVectorService = (url: string, token: string) => 
  new VectorService(url, token);
