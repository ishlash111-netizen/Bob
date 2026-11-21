import app from "../server";

export default function handler(req: any, res: any) {
  // Ensure Express matches /api/chat route (CORS handled securely inside server.ts)
  req.url = "/api/chat";
  return app(req, res);
}
