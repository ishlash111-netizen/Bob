import app from "../server";

export default function handler(req: any, res: any) {
  // Ensure routing works whether called directly or rewritten (CORS handled securely inside server.ts)
  const target = req.url || "/api";
  if (!target.startsWith("/api")) {
    req.url = `/api${target}`;
  }

  return app(req, res);
}
