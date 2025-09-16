import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Define our MCP agent with tools
export class MyMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "Authless Calculator",
    version: "1.0.0",
  });

  async init() {
    // Random number tool
    this.server.tool(
      "randomNumber",
      { startRange: z.number(), endRange: z.number() },
      async ({ startRange, endRange }) => {
        try {
          // Get true randomness from drand Cloudflare endpoint
          const response = await fetch(
            "https://drand.cloudflare.com/public/latest"
          );
          const data = (await response.json()) as { randomness: string };

          // Use the randomness value as seed
          // Take a random 8-character slice from the full randomness string
          const randomHex = data.randomness;
          const startIndex = Math.floor(Math.random() * (randomHex.length - 8));
          const randomValue = parseInt(
            randomHex.slice(startIndex, startIndex + 8),
            16
          );

          // Scale to the requested range
          const scaledRandom =
            (Math.abs(randomValue) % (endRange - startRange + 1)) + startRange;

          return {
            content: [
              {
                type: "text",
                text: String(scaledRandom),
              },
            ],
          };
        } catch (error) {
          // Fallback to Math.random if fetch fails
          return {
            content: [
              {
                type: "text",
                text: String(
                  Math.floor(Math.random() * (endRange - startRange + 1)) +
                    startRange
                ),
              },
            ],
          };
        }
      }
    );

    // Zammad search tool
    this.server.tool(
      "ticketSearch",
      { query: z.string() },
      async ({ query }) => {
        const ticketSearchEndpoint = new URL(
          "/api/v1/tickets/search",
          this.env.ZAMMAD_BASE_URL // "https://my.zammad.com"
        );
        ticketSearchEndpoint.searchParams.set("query", query);
        ticketSearchEndpoint.searchParams.set("per_page", "10");

        // Auth using "HTTP Token Authentication (access token)"
        const response = await fetch(ticketSearchEndpoint, {
          headers: {
            authorization: `Token token=${this.env.ZAMMAD_TOKEN}`,
          },
        });
        const data = (await response.json()) as { id: string; title: string }[];
        return {
          content: [
            {
              type: "text",
              text: data
                .map(
                  ({ id, title }) =>
                    `<ticket><id>${id}</id><title>${title}</title></ticket>`
                )
                .join("\n\n"),
            },
          ],
        };
      }
    );

    // Simple addition tool
    this.server.tool(
      "add",
      { a: z.number(), b: z.number() },
      async ({ a, b }) => ({
        content: [{ type: "text", text: String(a + b) }],
      })
    );

    // Calculator tool with multiple operations
    this.server.tool(
      "calculate",
      {
        operation: z.enum(["add", "subtract", "multiply", "divide"]),
        a: z.number(),
        b: z.number(),
      },
      async ({ operation, a, b }) => {
        let result: number;
        switch (operation) {
          case "add":
            result = a + b;
            break;
          case "subtract":
            result = a - b;
            break;
          case "multiply":
            result = a * b;
            break;
          case "divide":
            if (b === 0)
              return {
                content: [
                  {
                    type: "text",
                    text: "Error: Cannot divide by zero",
                  },
                ],
              };
            result = a / b;
            break;
        }
        return { content: [{ type: "text", text: String(result) }] };
      }
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp") {
      return MyMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
