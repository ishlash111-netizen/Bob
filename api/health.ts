import app from "../server";

export default function handler(req: any, res: any) {

  req.url = "/api/health";
  return app(req, res);
}
